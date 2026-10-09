import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, X, Loader2, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const BUCKET = "product-images";

/** In-memory cache for signed URLs to avoid refetching within a session. */
type CacheEntry = { url: string; expiresAt: number };
const urlCache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string | null>>();
const TTL_MS = 55 * 60 * 1000; // signed URL lives 60m; refresh a bit earlier

/** Turn a stored value (either full URL or storage path) into a viewable URL. Cached in memory. */
export async function resolveProductImageUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("http")) return value;
  const now = Date.now();
  const cached = urlCache.get(value);
  if (cached && cached.expiresAt > now) return cached.url;
  const inflight = pending.get(value);
  if (inflight) return inflight;
  const p = (async () => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(value, 60 * 60);
    if (error || !data?.signedUrl) return null;
    urlCache.set(value, { url: data.signedUrl, expiresAt: Date.now() + TTL_MS });
    return data.signedUrl;
  })();
  pending.set(value, p);
  try { return await p; } finally { pending.delete(value); }
}

/** Invalidate cached URL (call after upload/replace/remove). */
export function invalidateProductImageUrl(value: string | null) {
  if (value) urlCache.delete(value);
}

type Props = {
  /** Current stored value (storage path or full URL). */
  value: string | null;
  /** Called with new storage path (or null when cleared). */
  onChange: (path: string | null) => void;
};

export function ProductImageUpload({ value, onChange }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    resolveProductImageUrl(value).then((u) => {
      if (!cancelled) setPreview(u);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const upload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Only image files are allowed");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image must be under 5 MB");
        return;
      }
      setBusy(true);
      try {
        const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
        // best-effort cleanup of previous image if it was a storage path
        if (value && !value.startsWith("http")) {
          await supabase.storage.from(BUCKET).remove([value]).catch(() => {});
          invalidateProductImageUrl(value);
        }
        onChange(path);
        toast.success("Image uploaded");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onChange, value],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  const clear = async () => {
    if (value && !value.startsWith("http")) {
      await supabase.storage.from(BUCKET).remove([value]).catch(() => {});
      invalidateProductImageUrl(value);
    }
    onChange(null);
    setPreview(null);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={[
        "relative flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 transition-colors",
        drag ? "border-primary bg-primary/5" : "border-muted-foreground/25",
        "min-h-[140px]",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />

      {preview ? (
        <div className="relative">
          <img
            src={preview}
            alt="Product"
            className="h-32 w-32 rounded-md object-cover border"
          />
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="absolute -top-2 -right-2 h-6 w-6"
            onClick={clear}
            title="Remove image"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <ImageIcon className="h-8 w-8" />
          <p className="text-xs">Drag &amp; drop an image here</p>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <UploadCloud className="h-3.5 w-3.5" /> {preview ? "Replace" : "Choose file"}
          </>
        )}
      </Button>
    </div>
  );
}
