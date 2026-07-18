export interface MediaStore {
  readonly persistence: "browser-preview" | "session-only";
  put(trackId: string, file: Blob): Promise<string>;
  getUrl(trackId: string): Promise<string | null>;
  remove(trackId: string): Promise<void>;
  disposeUrls(): void;
}

const objectUrl = (blob: Blob): string => URL.createObjectURL(blob);

class SessionMediaStore implements MediaStore {
  readonly persistence = "session-only" as const;
  private readonly blobs = new Map<string, Blob>();
  private readonly urls = new Map<string, string>();

  async put(trackId: string, file: Blob): Promise<string> {
    await this.remove(trackId);
    this.blobs.set(trackId, file);
    const url = objectUrl(file);
    this.urls.set(trackId, url);
    return url;
  }

  async getUrl(trackId: string): Promise<string | null> {
    const existing = this.urls.get(trackId);
    if (existing) return existing;
    const blob = this.blobs.get(trackId);
    if (!blob) return null;
    const url = objectUrl(blob);
    this.urls.set(trackId, url);
    return url;
  }

  async remove(trackId: string): Promise<void> {
    const existing = this.urls.get(trackId);
    if (existing) URL.revokeObjectURL(existing);
    this.urls.delete(trackId);
    this.blobs.delete(trackId);
  }

  disposeUrls(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

const databaseName = "tap-preview-unofficial-suno-player";
const storeName = "owned-audio-v1";

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Browser preview media storage could not be opened."));
  request.onblocked = () => reject(new Error("Browser preview media storage is blocked by another tab."));
});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Browser preview media storage failed."));
});

class PreviewMediaStore implements MediaStore {
  readonly persistence = "browser-preview" as const;
  private readonly urls = new Map<string, string>();

  async put(trackId: string, file: Blob): Promise<string> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      await requestResult(transaction.objectStore(storeName).put(file, trackId));
    } finally {
      database.close();
    }
    const previous = this.urls.get(trackId);
    if (previous) URL.revokeObjectURL(previous);
    const url = objectUrl(file);
    this.urls.set(trackId, url);
    return url;
  }

  async getUrl(trackId: string): Promise<string | null> {
    const existing = this.urls.get(trackId);
    if (existing) return existing;
    const database = await openDatabase();
    let value: unknown;
    try {
      const transaction = database.transaction(storeName, "readonly");
      value = await requestResult(transaction.objectStore(storeName).get(trackId));
    } finally {
      database.close();
    }
    if (!(value instanceof Blob)) return null;
    const url = objectUrl(value);
    this.urls.set(trackId, url);
    return url;
  }

  async remove(trackId: string): Promise<void> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      await requestResult(transaction.objectStore(storeName).delete(trackId));
    } finally {
      database.close();
    }
    const existing = this.urls.get(trackId);
    if (existing) URL.revokeObjectURL(existing);
    this.urls.delete(trackId);
  }

  disposeUrls(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

let packagedStore: MediaStore | null = null;
let previewStore: MediaStore | null = null;

export const getMediaStore = (preview: boolean): MediaStore => {
  if (preview) {
    previewStore ??= new PreviewMediaStore();
    return previewStore;
  }
  packagedStore ??= new SessionMediaStore();
  return packagedStore;
};
