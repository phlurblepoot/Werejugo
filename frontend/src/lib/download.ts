import { api, type DownloadPurpose } from "../api/client";

/**
 * Start a big download (server backup, a family's data). The file is served as
 * an attachment, so following the link saves it without leaving the page.
 */
export async function startDownload(purpose: DownloadPurpose): Promise<void> {
  const url = await api.downloadLink(purpose);
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
