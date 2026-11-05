import { useState } from "react";
import { ZoomIn } from "lucide-react";

import { AttachmentPreviewDialog, type MessageAttachmentContext, type PreviewImage } from "@/components/AttachmentPreview";
import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { useCachedMedia } from "@/lib/media-cache";

// Nothing is fetched until the cached bytes are ready: an image element pointed at the original URL would
// hit the network on every mount, which is the cost this cache exists to remove.
const BLANK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function screenFramePreview(message: MessageAttachmentContext, mime = "image/png"): PreviewImage {
  const src = `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/image`;
  return {
    src,
    name: t("chat.botScreen"),
    downloadUrl: src,
    downloadName: mime === "image/jpeg" ? "screen.jpg" : "screen.png",
  };
}

export function ScreenFrame({ threadId, message }: { threadId: string; message: Message }) {
  const [open, setOpen] = useState(false);
  if (!message.hasImage && !message.png) return null;
  const image = screenFramePreview({ threadId, messageId: message.id }, message.mime);
  const cachedSrc = useCachedMedia(image.src);
  return (
    <div className="flex justify-start">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("attach.previewAria", { name: image.name })}
        className="group/image relative w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] overflow-hidden rounded-2xl border border-hairline/40 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <img
          src={cachedSrc ?? BLANK_PIXEL}
          alt={image.name}
          // A long conversation can hold dozens of screenshots: only the ones scrolled into view download,
          // and each is decoded off the main thread so the transcript keeps painting.
          loading="lazy"
          decoding="async"
          className="block max-w-full transition duration-200 group-hover/image:scale-[1.015]"
        />
        <span
          aria-hidden
          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/image:opacity-100 group-focus-within/image:opacity-100"
        >
          <ZoomIn size={13} />
        </span>
      </button>
      {open && <AttachmentPreviewDialog image={image} onClose={() => setOpen(false)} />}
    </div>
  );
}
