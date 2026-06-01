declare global {
  interface Window {
    /** 由 Rust 在创建贴图窗口时注入，避免超长 URL 导致 WebView 导航失败 */
    __PINCOPY_CONTENT__?: string;
  }
}

/** 将 Base64 字符串解码为 UTF-8 文本（atob 仅支持 Latin-1，中文会乱码） */
export function decodeBase64Utf8(base64: string): string {  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export function decodePinContent(search = window.location.search): string {
  const injected = window.__PINCOPY_CONTENT__;
  if (typeof injected === "string" && injected.length > 0) {
    return injected;
  }

  const encoded = new URLSearchParams(search).get("content");
  if (!encoded) return "";
  try {
    return decodeBase64Utf8(decodeURIComponent(encoded));
  } catch {
    return "";
  }
}