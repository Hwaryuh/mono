import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { InMemoryMediaStore, type MediaStore } from "./media-store";

const MediaStoreContext = createContext<MediaStore>(new InMemoryMediaStore());

export const MediaStoreProvider = MediaStoreContext.Provider;

export function useMediaStore(): MediaStore {
  return useContext(MediaStoreContext);
}

/** mediaId로 data URL을 지연 로드한다. 렌더 시점에만 무거운 바이트를 가져온다. */
export function useMedia(mediaId: string | null | undefined) {
  const store = useMediaStore();
  return useQuery({
    queryKey: ["media", mediaId],
    queryFn: () => store.load(mediaId as string),
    enabled: Boolean(mediaId),
    staleTime: Infinity,
  });
}
