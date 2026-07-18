import {
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  TRANSCRIPT_WORKER_FACTORY,
  type TranscriptWorkerFactory,
} from '@rusty-view/transcript-renderer';

import { provideRustyView } from './rusty-view-config';
import { appRoutes } from './app.routes';

const transcriptWorkerFactory: TranscriptWorkerFactory = () =>
  new Worker(new URL('./transcript.worker', import.meta.url));

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    {
      provide: TRANSCRIPT_WORKER_FACTORY,
      useValue: transcriptWorkerFactory,
    },
    provideRustyView(),
  ],
};
