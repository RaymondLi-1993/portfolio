import { createApp } from './app';
import { config } from './config';

// Local dev entry point (`npm run dev:api`). Production doesn't use this file:
// Netlify runs netlify/functions/api.ts instead, which has no port to listen on.
const port = config.PORT;

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
