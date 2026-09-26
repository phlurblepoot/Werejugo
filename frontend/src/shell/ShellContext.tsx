import { createContext, useContext } from "react";

/** Things the app shell offers to pages (e.g. the page header's search button). */
export interface ShellApi {
  openSearch?: () => void;
}

export const ShellContext = createContext<ShellApi>({});
export const useShell = () => useContext(ShellContext);
