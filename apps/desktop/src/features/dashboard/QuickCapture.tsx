import { translate } from "../../i18n/i18n";
import type { DashboardSnapshot } from "@mono/contracts";
import { formatByteSize, type PlatformModuleId } from "@mono/domain";
import { Button, Icon, Input, SectionHeader, type IconName } from "@mono/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router";
import { useMediaStore } from "../../infrastructure/media/media-store-context";
import { newMediaId } from "../../infrastructure/media/media-store";
import type { DashboardRepository } from "./dashboard-repository";

// While editing, keeps the original (File + preview data URL) only in memory, and on submit uploads it to R2 and passes only the mediaId.
type PendingMedia = { name: string; mimeType: string; size: number; dataUrl: string; file: File };

const moduleMeta: Record<PlatformModuleId, { name: string; color: string; icon: IconName }> = {
  todo: { name: translate("app.navigation.todo"), color: "oklch(0.539 0.082 160.129)", icon: "todo" },
  routine: { name: translate("app.navigation.routine"), color: "oklch(0.564 0.129 37.329)", icon: "routine" },
  calendar: { name: translate("app.navigation.calendar"), color: "oklch(0.604 0.149 260.322)", icon: "calendar" },
  scrap: { name: translate("app.navigation.scrap"), color: "oklch(0.502 0.132 309.199)", icon: "scrap" },
  ledger: { name: translate("app.navigation.ledger"), color: "oklch(0.603 0.109 75.876)", icon: "wallet" },
};

export const dashboardQueryKey = ["dashboard"] as const;

interface QuickCaptureProps {
  autoFocus?: boolean;
  repository: DashboardRepository;
  showHeading?: boolean;
  snapshot?: DashboardSnapshot;
}

const maxCaptureImages = 4;
const maxCaptureImageBytes = 10 * 1024 * 1024;
// A Gemini inline request has an overall 20MB limit. Leaves headroom for Base64 inflation and the JSON prompt.
const maxCaptureImageTotalBytes = 13 * 1024 * 1024;
const maxCaptureVideos = 1;
const maxCaptureVideoBytes = 100 * 1024 * 1024;

type DropMode = "text" | "media" | null;

function dropModeOf(dataTransfer: DataTransfer): DropMode {
  const types = Array.from(dataTransfer.types);
  if (types.includes("Files")) return "media";
  if (types.includes("text/uri-list") || types.includes("text/plain")) return "text";
  return null;
}

function droppedTextOf(dataTransfer: DataTransfer) {
  const droppedUrl = dataTransfer.getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return droppedUrl ?? dataTransfer.getData("text/plain").trim();
}

function captureImageOf(file: File) {
  return new Promise<PendingMedia>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(translate("quickCapture.error.readImage")));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(translate("quickCapture.error.readImage")));
        return;
      }
      resolve({ name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result, file });
    };
    reader.readAsDataURL(file);
  });
}

function captureVideoOf(file: File) {
  return new Promise<PendingMedia>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(translate("quickCapture.error.readVideo")));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(translate("quickCapture.error.readVideo")));
        return;
      }
      resolve({ name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result, file });
    };
    reader.readAsDataURL(file);
  });
}

// Attachment size display uses the shared domain formatter. The name is kept for compatibility with existing imports.
export const formatMediaSize = formatByteSize;

export function QuickCapture({ autoFocus = false, repository, showHeading = false, snapshot }: QuickCaptureProps) {
  const [captureText, setCaptureText] = useState("");
  const [captureImages, setCaptureImages] = useState<PendingMedia[]>([]);
  const [captureVideos, setCaptureVideos] = useState<PendingMedia[]>([]);
  const [mediaPending, setMediaPending] = useState(false);
  const [dragMode, setDragMode] = useState<DropMode>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const mediaStore = useMediaStore();
  const captureMutation = useMutation({
    mutationFn: async (pending: { raw: string; images: PendingMedia[]; videos: PendingMedia[] }) => {
      const persist = async ({ dataUrl: _dataUrl, file, ...meta }: PendingMedia) => {
        const mediaId = newMediaId();
        await mediaStore.save(mediaId, file);
        return { ...meta, mediaId };
      };
      // Sends the image as a dataUrl — the server uses it only for capture analysis (Gemini) and does not persist it.
      const [images, videos] = await Promise.all([
        Promise.all(pending.images.map(async (image) => ({ ...(await persist(image)), dataUrl: image.dataUrl }))),
        Promise.all(pending.videos.map(persist)),
      ]);
      return repository.capture({ raw: pending.raw, images, videos });
    },
    onSuccess: async () => {
      setCaptureText("");
      setCaptureImages([]);
      setCaptureVideos([]);
      setDropError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      ]);
    },
  });

  function submitCapture(event: FormEvent) {
    event.preventDefault();
    const raw = captureText.trim();
    if ((!raw && captureImages.length === 0 && captureVideos.length === 0) || captureMutation.isPending || mediaPending) return;
    setDropError(null);
    captureMutation.reset();
    captureMutation.mutate({ raw, images: captureImages, videos: captureVideos });
  }

  async function addMedia(files: File[]) {
    if (files.length === 0 || mediaPending) return;
    if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
      setDropError(translate("quickCapture.error.unsupportedMedia"));
      return;
    }
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const videoFiles = files.filter((file) => file.type.startsWith("video/"));
    if (imageFiles.some((file) => file.size > maxCaptureImageBytes)) {
      setDropError(translate("quickCapture.error.imageTooLarge"));
      return;
    }
    if ([...captureImages, ...imageFiles].reduce((total, file) => total + file.size, 0) > maxCaptureImageTotalBytes) {
      setDropError(translate("quickCapture.error.imagesTooLarge"));
      return;
    }
    if (videoFiles.some((file) => file.size > maxCaptureVideoBytes)) {
      setDropError(translate("quickCapture.error.videoTooLarge"));
      return;
    }
    if (captureImages.length + imageFiles.length > maxCaptureImages) {
      setDropError(translate("quickCapture.error.tooManyImages", { max: maxCaptureImages }));
      return;
    }
    if (captureVideos.length + videoFiles.length > maxCaptureVideos) {
      setDropError(translate("quickCapture.error.tooManyVideos"));
      return;
    }
    setMediaPending(true);
    setDropError(null);
    captureMutation.reset();
    try {
      const [nextImages, nextVideos] = await Promise.all([
        Promise.all(imageFiles.map(captureImageOf)),
        Promise.all(videoFiles.map(captureVideoOf)),
      ]);
      setCaptureImages((current) => [...current, ...nextImages].slice(0, maxCaptureImages));
      setCaptureVideos((current) => [...current, ...nextVideos].slice(0, maxCaptureVideos));
    } catch {
      setDropError(translate("quickCapture.error.readMedia"));
    } finally {
      setMediaPending(false);
    }
  }

  function enterDropZone(event: DragEvent<HTMLElement>) {
    const nextMode = dropModeOf(event.dataTransfer);
    if (!nextMode) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragMode(nextMode);
  }

  function leaveDropZone(event: DragEvent<HTMLElement>) {
    if (!dropModeOf(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragMode(null);
  }

  function keepDropZoneActive(event: DragEvent<HTMLElement>) {
    const nextMode = dropModeOf(event.dataTransfer);
    if (!nextMode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragMode(nextMode);
  }

  function dropCapture(event: DragEvent<HTMLElement>) {
    const droppedMode = dropModeOf(event.dataTransfer);
    if (!droppedMode) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragMode(null);
    if (droppedMode === "media") {
      void addMedia(Array.from(event.dataTransfer.files));
      return;
    }
    const droppedText = droppedTextOf(event.dataTransfer);
    if (!droppedText) {
      setDropError(translate("quickCapture.error.emptyDrop"));
      return;
    }
    const nextText = [captureText.trim(), droppedText].filter(Boolean).join(" ");
    if (nextText.length > 2_000) {
      setDropError(translate("quickCapture.error.textTooLong"));
      return;
    }
    setCaptureText(nextText);
    setDropError(null);
    captureMutation.reset();
  }

  return (
    <section
      aria-label={translate("quickCapture.dropZone.label")}
      className={`quick-capture ${dragMode ? "quick-capture--dragging" : ""}`.trim()}
      onDragEnter={enterDropZone}
      onDragLeave={leaveDropZone}
      onDragOver={keepDropZoneActive}
      onDrop={dropCapture}
    >
      <div aria-hidden="true" className="quick-capture__drop-feedback">
        <Icon name={dragMode === "media" ? "video" : "inbox"} size={18} strokeWidth={1.6} />
        <strong>{dragMode === "media" ? translate("quickCapture.dropZone.mediaPrompt") : translate("quickCapture.dropZone.textPrompt")}</strong>
        <span>{translate("quickCapture.dropZone.hint")}</span>
      </div>

      {showHeading && <SectionHeader title={<span className="section-title-with-icon"><Icon name="sparkles" size={15} strokeWidth={1.5} />{translate("app.quickCapture.title")}</span>} />}
      <form aria-busy={captureMutation.isPending} className="capture-form" onSubmit={submitCapture}>
        <Input
          aria-label={translate("app.quickCapture.title")}
          data-overlay-autofocus={autoFocus ? "true" : undefined}
          maxLength={2_000}
          onChange={(event) => {
            setCaptureText(event.target.value);
            setDropError(null);
            if (captureMutation.isError) captureMutation.reset();
          }}
          placeholder={translate("quickCapture.input.placeholder")}
          value={captureText}
        />
        <input
          accept="image/*,video/*"
          aria-label={translate("quickCapture.mediaPicker.label")}
          className="capture-file-input"
          multiple
          onChange={(event) => {
            void addMedia(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
          ref={mediaInputRef}
          type="file"
        />
        <Button aria-label={translate("quickCapture.action.addMedia")} disabled={captureMutation.isPending || mediaPending} onClick={() => mediaInputRef.current?.click()} type="button">
          <Icon name="file" size={15} strokeWidth={1.7} />
        </Button>
        <Button aria-label={translate("quickCapture.action.submit")} loading={captureMutation.isPending} type="submit" variant="primary">
          <Icon name="send" size={15} strokeWidth={2} />
        </Button>
      </form>

      {(captureImages.length > 0 || captureVideos.length > 0 || mediaPending) && (
        <div aria-label={translate("quickCapture.attachments.label")} className="capture-images" role="list">
          {captureImages.map((image, index) => (
            <div className="capture-image" key={`${image.name}-${image.size}-${index}`} role="listitem">
              <img alt={image.name} src={image.dataUrl} />
              <span><strong title={image.name}>{image.name}</strong><small>{formatMediaSize(image.size)}</small></span>
              <button
                aria-label={translate("quickCapture.attachments.remove", { name: image.name })}
                onClick={() => setCaptureImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
                type="button"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          {captureVideos.map((video, index) => (
            <div className="capture-image" key={`${video.name}-${video.size}-${index}`} role="listitem">
              <div aria-label={translate("quickCapture.attachments.videoLabel", { name: video.name })} className="capture-video-placeholder" role="img"><Icon name="video" size={16} /></div>
              <span><strong title={video.name}>{video.name}</strong><small>{translate("quickCapture.attachments.videoClassification", { size: formatMediaSize(video.size) })}</small></span>
              <button
                aria-label={translate("quickCapture.attachments.remove", { name: video.name })}
                onClick={() => setCaptureVideos((current) => current.filter((_, videoIndex) => videoIndex !== index))}
                type="button"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          {mediaPending && <span className="capture-image-loading" role="status">{translate("quickCapture.attachments.loading")}</span>}
        </div>
      )}

      {(dropError || captureMutation.isError) && (
        <p className="capture-error" role="alert">{dropError ?? translate("quickCapture.error.submit")}</p>
      )}

      {snapshot && (
        <div className="capture-meta">
          <span className="capture-meta__label">{translate("quickCapture.recent.label")}</span>
          {snapshot.recentCaptures.length === 0 && <span className="capture-meta__empty">{translate("quickCapture.recent.empty")}</span>}
          {snapshot.recentCaptures.slice(0, 2).map((capture) => {
            const meta = moduleMeta[capture.module];
            return (
              <Link className="capture-chip" key={capture.id} to="/inbox">
                <span className="capture-chip__raw">{capture.raw}</span>
                <Icon name="chevronRight" size={10} />
                <Icon name={meta.icon} size={11} style={{ color: meta.color }} />
                <span>{meta.name}</span><span>{Math.round(capture.confidence * 100)}%</span>
              </Link>
            );
          })}
          <Link className="inbox-link" to="/inbox">{translate("quickCapture.inbox.pendingCount", { count: snapshot.pendingCaptureCount })}<Icon name="chevronRight" size={11} /></Link>
        </div>
      )}
    </section>
  );
}
