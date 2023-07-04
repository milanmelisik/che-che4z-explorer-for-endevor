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

import { toServiceUrl } from '../../utils';
import { withCancellableNotificationProgress } from '@local/vscode-wrapper/window';
import { askForConnectionDetails } from '../../dialogs/locations/endevorServiceDialogs';
import { getApiVersion } from '../../endevor';
import { logger, reporter } from '../../globals';
import { Action, Actions } from '../../store/_doc/Actions';
import {
  EndevorConnection,
  EndevorConnectionStatus,
  EndevorCredentialStatus,
  EndevorId,
} from '../../store/_doc/v2/Store';
import { InvalidLocationNode } from '../../tree/_doc/ServiceLocationTree';
import {
  EditConnectionDetailsCommandCompletedStatus,
  TelemetryEvents,
} from '../../_doc/telemetry/Telemetry';
import { Source } from '../../store/storage/_doc/Storage';
import { UnreachableCaseError } from '@local/endevor/typeHelpers';
import { CredentialType } from '@local/endevor/_doc/Credential';

export const editConnectionDetailsCommand =
  (
    getConnectionDetails: (id: EndevorId) => EndevorConnection | undefined,
    dispatch: (action: Action) => Promise<void>
  ) =>
  async (invalidLocationNode: InvalidLocationNode): Promise<void> => {
    logger.trace('Modify Endevor connection command called.');
    const serviceId = {
      name: invalidLocationNode.serviceName,
      source: invalidLocationNode.serviceSource,
    };
    const connectionDetails = getConnectionDetails(serviceId);
    const editedConnection = await askForConnectionDetails(
      (location, rejectUnauthorized) =>
        withCancellableNotificationProgress('Testing Endevor connection ...')(
          (progressReporter) =>
            getApiVersion(progressReporter)(location)(rejectUnauthorized)
        ),
      () => Promise.resolve(false),
      connectionDetails
        ? toServiceUrl(connectionDetails.value.location)
        : undefined
    );
    if (!editedConnection) {
      logger.trace('No new connection details provided.');
      reporter.sendTelemetryEvent({
        type: TelemetryEvents.COMMAND_EDIT_CONNECTION_DETAILS_COMPLETED,
        status: EditConnectionDetailsCommandCompletedStatus.CANCELLED,
      });
      return;
    }
    if (editedConnection.connection.status !== EndevorConnectionStatus.VALID) {
      logger.trace('Invalid connection details provided.');
      const error = new Error('Invalid connection details provided.');
      reporter.sendTelemetryEvent({
        type: TelemetryEvents.ERROR,
        errorContext: TelemetryEvents.COMMAND_EDIT_CONNECTION_DETAILS_COMPLETED,
        status: EditConnectionDetailsCommandCompletedStatus.GENERIC_ERROR,
        error,
      });
      return;
    }
    reporter.sendTelemetryEvent({
      type: TelemetryEvents.COMMAND_EDIT_CONNECTION_DETAILS_COMPLETED,
      status: EditConnectionDetailsCommandCompletedStatus.SUCCESS,
    });
    switch (invalidLocationNode.source) {
      case Source.INTERNAL:
        logger.info(
          'Updated Endevor connection details will be stored within the connection.'
        );
        dispatch({
          type: Actions.ENDEVOR_SERVICE_UPDATED,
          serviceId,
          connection: {
            status: EndevorConnectionStatus.VALID,
            value: editedConnection.connection.value,
          },
          credential:
            editedConnection.credential.user &&
            editedConnection.credential.password
              ? {
                  status: EndevorCredentialStatus.UNKNOWN,
                  value: {
                    type: CredentialType.BASE,
                    user: editedConnection.credential.user,
                    password: editedConnection.credential.password,
                  },
                }
              : undefined,
        });
        break;
      case Source.SYNCHRONIZED:
        logger.info(
          'Updated Endevor connection details will be stored within the current VSCode session.'
        );
        dispatch({
          type: Actions.SESSION_ENDEVOR_CONNECTION_ADDED,
          sessionId: serviceId,
          connection: editedConnection.connection,
        });
        break;
      default:
        throw new UnreachableCaseError(invalidLocationNode.source);
    }
  };
