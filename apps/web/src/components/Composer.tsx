import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  type SelectOptionDto,
} from "@codex-remote/shared";
import { Paperclip, Send, Settings2, Square, Waypoints, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

export interface ComposerSettings {
  model: string;
  serviceTier: string;
  effort: string;
  collaborationMode: string;
  permissions: string;
}

interface ComposerProps {
  active: boolean;
  disabled: boolean;
  submitting: boolean;
  models: SelectOptionDto[];
  collaborationModes: SelectOptionDto[];
  permissionProfiles: SelectOptionDto[];
  settings: ComposerSettings;
  draft: { id: number; text: string } | null;
  onSettings: (settings: ComposerSettings) => void;
  onSend: (text: string, images: File[]) => Promise<void>;
  onInterrupt: () => Promise<void>;
}

interface SelectedImage {
  key: string;
  file: File;
  previewUrl: string;
}

export function Composer(props: ComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const imagesRef = useRef(images);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => {
      for (const image of imagesRef.current) {
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
      }
    },
    [],
  );

  useEffect(() => {
    if (!props.draft) return;
    setText(props.draft.text);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(
        props.draft?.text.length ?? 0,
        props.draft?.text.length ?? 0,
      );
    });
  }, [props.draft]);

  useEffect(() => {
    const target = textarea.current;
    if (!target) return;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 140)}px`;
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if ((!value && images.length === 0) || props.disabled || props.submitting)
      return;
    setError("");
    try {
      await props.onSend(
        value,
        images.map((image) => image.file),
      );
      setText("");
      for (const image of images) {
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
      }
      setImages([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送失败。");
    }
  };

  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    const available = MAX_ATTACHMENTS_PER_TURN - images.length;
    if (selected.length > available) {
      setError(`每次最多发送 ${MAX_ATTACHMENTS_PER_TURN} 张图片。`);
      return;
    }
    const invalid = selected.find(
      (file) =>
        !ALLOWED_IMAGE_MIME_TYPES.includes(
          file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number],
        ) ||
        file.size === 0 ||
        file.size > MAX_ATTACHMENT_BYTES,
    );
    if (invalid) {
      setError("仅支持不超过 10 MB 的 JPEG、PNG 和 WebP 图片。");
      return;
    }
    setError("");
    setImages((current) => [
      ...current,
      ...selected.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeImage = (key: string) => {
    setImages((current) => {
      const target = current.find((image) => image.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.key !== key);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  const update = (key: keyof ComposerSettings, value: string) => {
    props.onSettings({ ...props.settings, [key]: value });
  };

  return (
    <div className="composer-shell">
      {showSettings ? (
        <div className="composer-settings">
          <label>
            <span>模型</span>
            <select
              value={props.settings.model}
              onChange={(e) => update("model", e.target.value)}
            >
              <option value="">沿用当前</option>
              {props.models.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>模式</span>
            <select
              value={props.settings.collaborationMode}
              onChange={(e) => update("collaborationMode", e.target.value)}
            >
              <option value="">沿用当前</option>
              {props.collaborationModes.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>推理</span>
            <select
              value={props.settings.effort}
              onChange={(e) => update("effort", e.target.value)}
            >
              <option value="">沿用当前</option>
              {["low", "medium", "high", "xhigh", "max", "ultra"].map(
                (value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <span>权限</span>
            <select
              value={props.settings.permissions}
              onChange={(e) => update("permissions", e.target.value)}
            >
              <option value="">沿用当前</option>
              {props.permissionProfiles.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>速度</span>
            <select
              value={props.settings.serviceTier}
              onChange={(e) => update("serviceTier", e.target.value)}
            >
              <option value="">沿用当前</option>
              <option value="default">Standard</option>
              <option value="fast">Fast</option>
              <option value="priority">Priority</option>
            </select>
          </label>
        </div>
      ) : null}
      {error ? (
        <p className="form-error composer-error" role="alert">
          {error}
        </p>
      ) : null}
      {images.length ? (
        <div className="composer-attachments" aria-label="待发送图片">
          {images.map((image) => (
            <div className="composer-attachment" key={image.key}>
              <img src={image.previewUrl} alt={image.file.name} />
              <button
                type="button"
                onClick={() => removeImage(image.key)}
                title="移除图片"
                aria-label={`移除图片 ${image.file.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer">
        <button
          className={`icon-button ${showSettings ? "active" : ""}`}
          onClick={() => setShowSettings((value) => !value)}
          title="会话设置"
          aria-label="会话设置"
        >
          <Settings2 size={19} />
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          aria-label="选择图片"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          multiple
          onChange={selectImages}
          tabIndex={-1}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileInput.current?.click()}
          disabled={props.disabled || images.length >= MAX_ATTACHMENTS_PER_TURN}
          title="添加图片"
          aria-label="添加图片"
        >
          <Paperclip size={19} />
        </button>
        <textarea
          ref={textarea}
          aria-label="发送消息"
          placeholder={props.active ? "追加指令" : "发送消息"}
          rows={1}
          value={text}
          disabled={props.disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {props.active ? (
          <button
            className="icon-button stop-button"
            onClick={() => void props.onInterrupt()}
            title="中断"
            aria-label="中断"
          >
            <Square size={17} fill="currentColor" />
          </button>
        ) : null}
        <button
          className="primary-icon-button"
          disabled={
            props.disabled ||
            props.submitting ||
            (!text.trim() && images.length === 0)
          }
          onClick={() => void submit()}
          title={props.active ? "追加指令" : "发送"}
          aria-label={props.active ? "追加指令" : "发送"}
        >
          {props.active ? <Waypoints size={19} /> : <Send size={19} />}
        </button>
      </div>
    </div>
  );
}
