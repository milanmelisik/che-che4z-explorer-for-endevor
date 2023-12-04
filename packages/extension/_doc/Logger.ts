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

export type LoggerMessageWithOptions = {
  value: string;
  options: ReadonlyArray<string>;
  optionsCallback: (choice: string | undefined) => Promise<void>;
};

export interface Logger {
  trace: (msg: string) => void;
  info: (userMsg: string, logMsg?: string) => void;
  warn: (
    userMsg:
      | string
      | {
          value: string;
          options: ReadonlyArray<string>;
          optionsCallback: (choice: string | undefined) => Promise<void>;
        },
    logMsg?: string
  ) => void;
  error: (userMsg: string | LoggerMessageWithOptions, logMsg?: string) => void;
}
