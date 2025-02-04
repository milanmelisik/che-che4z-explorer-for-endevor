/*
 * © 2023 Broadcom Inc and/or its subsidiaries; All rights reserved
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Broadcom, Inc. - initial API and implementation
 */

import {
  askForSearchLocationOrCreateNew,
  dialogCancelled as locationDialogCancelled,
  locationChosen,
} from '../../dialogs/locations/endevorSearchLocationDialogs';
import { reporter } from '../../globals';
import { formatWithNewLines, isDefined } from '../../utils';
import { Action, Actions } from '../../store/_doc/Actions';
import {
  EndevorId,
  EndevorLocationName,
  EndevorServiceDescriptions,
  ValidEndevorConnection,
  ValidEndevorSearchLocationDescriptions,
  ExistingEndevorServiceDescriptions,
  EndevorConnectionStatus,
} from '../../store/_doc/v2/Store';
import {
  CommandAddNewSearchLocationCompletedStatus,
  TelemetryEvents,
} from '../../telemetry/_doc/Telemetry';
import {
  askForService,
  dialogCancelled as serviceDialogCancelled,
} from '../../dialogs/locations/endevorServiceDialogs';
import { ValidServiceNode } from '../../tree/_doc/ServiceLocationTree';
import {
  focusOnView,
  withCancellableNotificationProgress,
} from '@local/vscode-wrapper/window';
import { getConfigurationsAndLogActivity } from '../../api/endevor';
import { TREE_VIEW_ID } from '../../constants';
import { isErrorEndevorResponse } from '@local/endevor/utils';
import { ErrorResponseType } from '@local/endevor/_doc/Endevor';
import { UnreachableCaseError } from '@local/endevor/typeHelpers';
import {
  EndevorLogger,
  createEndevorLogger,
  logActivity as setLogActivityContext,
} from '../../logger';

export const addNewSearchLocation =
  (
    dispatch: (action: Action) => Promise<void>,
    configurations: {
      getConnectionDetails: (
        id: EndevorId
      ) => Promise<ValidEndevorConnection | undefined>;
      getServiceDescriptionsBySearchLocationId: (
        searchLocationId: EndevorId
      ) => Promise<EndevorServiceDescriptions>;
      getSearchLocationNames: () => ReadonlyArray<EndevorLocationName>;
      getValidSearchLocationDescriptionsForService: (
        serviceId: EndevorId
      ) => ValidEndevorSearchLocationDescriptions;
      getValidUsedServiceDescriptions: () => Promise<ExistingEndevorServiceDescriptions>;
    }
  ) =>
  async (
    serviceArg?: EndevorId | ValidServiceNode
  ): Promise<EndevorId | undefined> => {
    const logger = createEndevorLogger();
    const serviceId = await resolveServiceId(logger)(
      await configurations.getValidUsedServiceDescriptions()
    )(serviceArg);
    if (!serviceId) return;
    logger.updateContext({ serviceId });
    logger.traceWithDetails(`Add an Endevor inventory location was called.`);
    const dialogResult = await askForSearchLocationOrCreateNew({
      locationsToChoose:
        configurations.getValidSearchLocationDescriptionsForService(serviceId),
      allExistingLocationNames: configurations.getSearchLocationNames(),
    })(async () => {
      const connectionDetails = await configurations.getConnectionDetails(
        serviceId
      );
      if (!connectionDetails) {
        logger.errorWithDetails('Unable to fetch Endevor connection.');
        return;
      }
      return withCancellableNotificationProgress(
        'Fetching Endevor configurations ...'
      )(async (progressReporter) => {
        const configurationsResponse = await getConfigurationsAndLogActivity(
          setLogActivityContext(dispatch, {
            serviceId,
          })
        )(progressReporter)({
          location: connectionDetails.value.location,
          rejectUnauthorized: connectionDetails.value.rejectUnauthorized,
        });
        if (isErrorEndevorResponse(configurationsResponse)) {
          const errorResponse = configurationsResponse;
          // TODO: format using all possible error details
          const error = new Error(
            `Unable to fetch Endevor configurations information for ${
              serviceId.name
            } because of error:${formatWithNewLines(
              errorResponse.details.messages
            )}`
          );
          switch (errorResponse.type) {
            case ErrorResponseType.CONNECTION_ERROR:
            case ErrorResponseType.CERT_VALIDATION_ERROR:
              logger.errorWithDetails(
                `Unable to connect to Endevor Web Service to fetch configurations for ${serviceId.name}.`,
                `${error.message}.`
              );
              reporter.sendTelemetryEvent({
                type: TelemetryEvents.ERROR,
                errorContext:
                  TelemetryEvents.COMMAND_ADD_NEW_SEARCH_LOCATION_COMPLETED,
                status:
                  CommandAddNewSearchLocationCompletedStatus.GENERIC_ERROR,
                error,
              });
              dispatch({
                type: Actions.ENDEVOR_CONNECTION_TESTED,
                connectionId: serviceId,
                status: {
                  status: EndevorConnectionStatus.INVALID,
                },
              });
              break;
            case ErrorResponseType.GENERIC_ERROR:
              logger.errorWithDetails(
                `Unable to fetch configurations for ${serviceId.name} from Endevor.`,
                `${error.message}.`
              );
              break;
            default:
              throw new UnreachableCaseError(errorResponse.type);
          }
          reporter.sendTelemetryEvent({
            type: TelemetryEvents.ERROR,
            errorContext:
              TelemetryEvents.COMMAND_ADD_NEW_SEARCH_LOCATION_COMPLETED,
            status: CommandAddNewSearchLocationCompletedStatus.GENERIC_ERROR,
            error,
          });
          return;
        }
        // TODO report warnings
        return configurationsResponse.result;
      });
    });
    if (locationDialogCancelled(dialogResult)) {
      logger.trace(
        'No Endevor inventory location was selected or newly created.'
      );
      reporter.sendTelemetryEvent({
        type: TelemetryEvents.COMMAND_ADD_NEW_SEARCH_LOCATION_COMPLETED,
        status: CommandAddNewSearchLocationCompletedStatus.CANCELLED,
      });
      return;
    }
    if (!locationChosen(dialogResult)) {
      const createdSearchLocation = dialogResult;
      dispatch({
        type: Actions.ENDEVOR_SEARCH_LOCATION_CREATED,
        serviceId,
        searchLocation: {
          value: createdSearchLocation.value,
          id: createdSearchLocation.id,
        },
      });
      reporter.sendTelemetryEvent({
        type: TelemetryEvents.COMMAND_ADD_NEW_SEARCH_LOCATION_COMPLETED,
        status:
          CommandAddNewSearchLocationCompletedStatus.NEW_SEARCH_LOCATION_CREATED,
        source: createdSearchLocation.id.source,
        serviceSource: serviceId.source,
      });
      await focusOnView(TREE_VIEW_ID);
      return createdSearchLocation.id;
    }
    const searchLocationId = dialogResult.id;
    const inUseByServicesAmount = Object.keys(
      await configurations.getServiceDescriptionsBySearchLocationId(
        searchLocationId
      )
    ).length;
    reporter.sendTelemetryEvent({
      type: TelemetryEvents.COMMAND_ADD_NEW_SEARCH_LOCATION_COMPLETED,
      ...(inUseByServicesAmount
        ? {
            status:
              CommandAddNewSearchLocationCompletedStatus.USED_EXISTING_SEARCH_LOCATION_CHOSEN,
            inUseByServicesAmount,
            source: searchLocationId.source,
            serviceSource: serviceId.source,
          }
        : {
            status:
              CommandAddNewSearchLocationCompletedStatus.UNUSED_EXISTING_LOCATION_CHOSEN,
            source: searchLocationId.source,
            serviceSource: serviceId.source,
          }),
    });
    dispatch({
      type: Actions.ENDEVOR_SEARCH_LOCATION_ADDED,
      serviceId,
      searchLocationId,
    });
    await focusOnView(TREE_VIEW_ID);
    return searchLocationId;
  };

const resolveServiceId =
  (logger: EndevorLogger) =>
  (servicesToChoose: ExistingEndevorServiceDescriptions) =>
  async (
    serviceArg?: EndevorId | ValidServiceNode
  ): Promise<EndevorId | undefined> => {
    if (!isDefined(serviceArg)) {
      const serviceKeys = Object.keys(servicesToChoose);
      if (serviceKeys.length === 1 && serviceKeys[0]) {
        return servicesToChoose[serviceKeys[0]]?.id;
      }
      const dialogResult = await askForService(servicesToChoose);
      if (serviceDialogCancelled(dialogResult)) {
        logger.trace('No Endevor connection was selected.');
        return;
      }
      return dialogResult.id;
    }
    return {
      name: serviceArg.name,
      source: serviceArg.source,
    };
  };
