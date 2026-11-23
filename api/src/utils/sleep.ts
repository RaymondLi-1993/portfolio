/** Wait `ms` milliseconds: `await sleep(1000)` pauses the calling async function for 1 second. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
