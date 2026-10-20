/** The mounted workspace supplies the gate; standalone settings retain their
 * existing explicit save behavior. This contract carries no settings values. */
export type SettingsWriteRunner = <T>(operation: () => Promise<T>) => Promise<T>;
export interface SettingsWriteProps { runSettingsWrite?: SettingsWriteRunner }
export const directSettingsWrite: SettingsWriteRunner = operation => operation();
