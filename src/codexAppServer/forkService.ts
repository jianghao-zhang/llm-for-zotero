import {
  archiveCodexAppServerThread,
  forkCodexAppServerThread,
  setCodexAppServerThreadName,
} from "./nativeClient";

export type CodexAppServerForkService = {
  forkThread: typeof forkCodexAppServerThread;
  archiveThread: typeof archiveCodexAppServerThread;
  setThreadName: typeof setCodexAppServerThreadName;
};

export const codexAppServerForkService: CodexAppServerForkService = {
  forkThread: forkCodexAppServerThread,
  archiveThread: archiveCodexAppServerThread,
  setThreadName: setCodexAppServerThreadName,
};
