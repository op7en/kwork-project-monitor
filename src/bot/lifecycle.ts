interface StoppableBot { isRunning(): boolean; stop(): Promise<void> }
/** Stop can precede asynchronous polling init; the requested shutdown is never forgotten. */
export function createBotLifecycle(bot: StoppableBot, monitor: { shutdown(): Promise<void> } | undefined,
  fail: () => void) {
  let requested = false;
  let monitorStop: Promise<void> | undefined, botStop: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    requested = true;
    monitorStop ??= (monitor?.shutdown() ?? Promise.resolve()).catch(fail);
    if (bot.isRunning()) botStop ??= bot.stop().catch(fail);
    await Promise.all([monitorStop, botStop]);
  };
  return { stop, ready(): boolean { if (requested) { void stop(); return false; } return true; } };
}
