/**
 * iOS/iPadOS file-picker compatibility for `<input type="file">`.
 *
 * On iOS/iPadOS every browser is WebKit, which turns an input's `accept` list
 * into a set of Uniform Type Identifiers handed to the native document picker
 * (UIDocumentPickerViewController). File extensions with no registered UTI —
 * `.ifc`, `.step`, `.iges`, `.glb`, `.obj`, `.stl`, … — are GREYED OUT
 * (non-selectable) whenever a sibling token that DOES resolve (e.g. `.zip`)
 * makes the allowed set non-empty. The result on iPad: a real `.ifc` sitting
 * in Downloads cannot be picked at all (WebKit Bugzilla 242110 / changeset
 * 274581 — `accept` → `_acceptedUTIs` → picker allowed content types).
 *
 * Fix: drop the `accept` attribute on iOS so the picker enables every file.
 * The backend still validates the chosen file's extension
 * (`ACCEPTED_UPLOAD_EXTS`), so the native filter is only a desktop convenience
 * and is safe to omit on iOS. Desktop keeps the full list (it works there).
 */

/** The model/package upload list shared by the project import inputs. */
export const MODEL_UPLOAD_ACCEPT =
  '.ifc,.zip,.step,.stp,.iges,.igs,.glb,.gltf,.obj,.stl,.dae,.fbx,.3ds,.ply';

/**
 * True on iPhone/iPad/iPod — including iPadOS 13+ Safari/Chrome, which default
 * to "desktop-class" browsing and report the UA + `navigator.platform` as a
 * Mac. The discriminator is touch: a real Mac reports `maxTouchPoints` 0–1, an
 * iPad reports ≥ 2. Because all iOS browsers are WebKit, this single OS-level
 * check correctly covers Safari, Chrome, Edge and Firefox on the device.
 */
export function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouch = navigator.maxTouchPoints || 0;
  const iOSByUA = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  const iPadOSAsMac =
    (platform === 'MacIntel' || platform === 'MacARM64' || /Mac/.test(ua)) && maxTouch > 1;
  return iOSByUA || iPadOSAsMac;
}

/**
 * The value to bind to a file input via `[attr.accept]`: the given desktop
 * `accept` list normally, or `null` on iOS so WebKit doesn't grey out
 * extension-only formats. Angular drops the attribute entirely when the bound
 * value is `null`. Always keep post-selection extension validation, since the
 * native type filter no longer constrains the choice on iOS.
 */
export function fileAccept(desktopAccept: string): string | null {
  return isIosLike() ? null : desktopAccept;
}
