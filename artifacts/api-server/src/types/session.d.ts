import 'express-session';

declare module 'express-session' {
  interface SessionData {
    dropboxUser?: {
      accountId: string;
      displayName: string;
      email: string;
    };
    dropboxConnectedAt?: string;
  }
}
