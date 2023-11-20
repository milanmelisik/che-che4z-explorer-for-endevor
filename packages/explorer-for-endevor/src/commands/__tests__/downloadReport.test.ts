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

import { describe } from 'mocha';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { CredentialType } from '@local/endevor/_doc/Credential';
import { mockDownloadReportById } from './_mocks/endevor';
import * as sinon from 'sinon';
import { printResultTableCommand } from '../../commands/printResultTable';
import { COMMAND_PREFIX } from '../../constants';
import { Schemas } from '../../uri/_doc/Uri';
import { resultTableContentProvider } from '../../view/resultTableContentProvider';
import { mockShowingDocumentWith } from './_mocks/window';
import { Source } from '../../store/storage/_doc/Storage';
import {
  EndevorAuthorizedService,
  SearchLocation,
} from '../../api/_doc/Endevor';

describe('fetch report content', () => {
  const retrieveReportCommandId = `${COMMAND_PREFIX}.retrieveReportCommandId`;
  before(() => {
    vscode.commands.registerCommand(
      retrieveReportCommandId,
      async (serviceId, searchLocationId, objectName, ccid, reportId) =>
        printResultTableCommand(serviceId, searchLocationId)(objectName)(ccid)(
          reportId
        )
    );
  });

  afterEach(() => {
    // Sinon has some issues with cleaning up the environment after itself, so we have to do it
    // TODO: take a look into Fake API instead of Stub
    sinon.restore();
  });

  const subSystemName = 'subSystemName';
  const configuration = 'TEST-CONFIG';
  const service: EndevorAuthorizedService = {
    location: {
      port: 1234,
      protocol: 'http',
      hostname: 'anything',
      basePath: 'anythingx2',
    },
    credential: {
      type: CredentialType.BASE,
      user: 'test',
      password: 'something',
    },
    rejectUnauthorized: false,
    configuration,
  };
  const reportId = 'TEST-REPORT-ID';
  const serviceId = {
    name: 'TEST-SERVICE',
    source: Source.INTERNAL,
  };
  const searchLocationId = {
    name: 'TEST-LOCATION',
    source: Source.INTERNAL,
  };
  const searchLocation: SearchLocation = {
    environment: 'ENV',
    stageNumber: '1',
  };
  const ccid = 'TEST-CCID';

  vscode.workspace.registerTextDocumentContentProvider(
    Schemas.READ_ONLY_REPORT,
    resultTableContentProvider(sinon.spy(), async () => ({
      service,
      searchLocation,
    }))
  );

  it('should fetch report content', async () => {
    // arrange
    const expectedReportContent = 'Best Endevor generated report right here!';
    const downloadReportStub = mockDownloadReportById(
      service,
      reportId
    )(expectedReportContent);
    const success = Promise.resolve();
    const showReportContentStub = mockShowingDocumentWith()(success);
    // act
    try {
      await vscode.commands.executeCommand(
        retrieveReportCommandId,
        serviceId,
        searchLocationId,
        subSystemName,
        ccid,
        reportId
      );
    } catch (e) {
      assert.fail(
        `Test failed because of uncaught error inside command: ${e.message}`
      );
    }
    // assert
    const [generalFunctionStub, withServiceStub, withReportIdStub] =
      downloadReportStub;
    assert.ok(
      generalFunctionStub.called,
      'Fetch report content was not called'
    );
    const actualService = withServiceStub.args[0]?.[0];
    assert.deepStrictEqual(
      actualService,
      service,
      `Fetch report by id was not called with expected ${service}, it was called with ${actualService}`
    );
    assert.ok(
      showReportContentStub.called,
      'Show report content was not called'
    );
    const actualReportId = withReportIdStub.args[0]?.[0];
    assert.deepStrictEqual(
      actualReportId,
      reportId,
      `Fetch report by id was not called with expected ${reportId}, it was called with ${actualReportId}`
    );
  });
});
