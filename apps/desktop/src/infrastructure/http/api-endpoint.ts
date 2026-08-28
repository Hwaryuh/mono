import { invoke, isTauri } from "@tauri-apps/api/core";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4174";

export interface ApiEndpointProvider {
  resolve(): Promise<string>;
}

export class PlatformApiEndpointProvider implements ApiEndpointProvider {
  private constructor() {}

  static of(): PlatformApiEndpointProvider {
    return new PlatformApiEndpointProvider();
  }

  async resolve(): Promise<string> {
    if (isTauri()) return invoke<string>("server_api_base_url");
    return import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  }
}
