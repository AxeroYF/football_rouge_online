#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PAYLOAD_ROOT="$SOURCE_ROOT/payload"
APP_SOURCE="$PAYLOAD_ROOT/YDL S4 Offline.app"
OUTPUT_DIR="$SOURCE_ROOT/dist"
WORK_DIR="$SOURCE_ROOT/.dmg-build"
VOLUME_DIR="$WORK_DIR/YDL S4 Offline"
DMG_PATH="$OUTPUT_DIR/YDL-S4-Offline-macOS-arm64-v1.2.1.dmg"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "错误：请在 Apple Silicon Mac（M1/M2/M3/M4）上运行。" >&2
  exit 1
fi
if [ ! -d "$APP_SOURCE" ]; then
  echo "错误：缺少应用载荷：$APP_SOURCE" >&2
  exit 1
fi
NODE_BIN="$APP_SOURCE/Contents/Resources/runtime/node"
APP_ROOT="$APP_SOURCE/Contents/Resources/app"

# ZIP archives created on Windows do not preserve Unix executable bits.
chmod +x "$APP_SOURCE/Contents/MacOS/YDL-S4-Offline"
chmod +x "$NODE_BIN"
if ! /usr/bin/file "$NODE_BIN" | /usr/bin/grep -q 'arm64'; then
  echo "错误：内置 Node 不是 Apple Silicon arm64 可执行文件。" >&2
  exit 1
fi
if [ ! -d "$APP_ROOT/node_modules/@img/sharp-darwin-arm64" ] || [ ! -d "$APP_ROOT/node_modules/@img/sharp-libvips-darwin-arm64" ]; then
  echo "错误：缺少 Apple Silicon sharp/libvips 依赖。" >&2
  exit 1
fi
(
  cd "$APP_ROOT"
  "$NODE_BIN" --input-type=module -e 'await import("exceljs"); const sharp = (await import("sharp")).default; await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).webp().toBuffer();'
)

rm -rf "$WORK_DIR"
mkdir -p "$VOLUME_DIR" "$OUTPUT_DIR"
/usr/bin/ditto "$APP_SOURCE" "$VOLUME_DIR/YDL S4 Offline.app"
chmod +x "$VOLUME_DIR/YDL S4 Offline.app/Contents/MacOS/YDL-S4-Offline"
chmod +x "$VOLUME_DIR/YDL S4 Offline.app/Contents/Resources/runtime/node"

# 好友间使用的临时自签名。首次打开若被 Gatekeeper 拦截，请右键应用后选择“打开”。
/usr/bin/codesign --force --deep --sign - "$VOLUME_DIR/YDL S4 Offline.app"
ln -s /Applications "$VOLUME_DIR/Applications"
cp "$SOURCE_ROOT/README-离线版.md" "$VOLUME_DIR/使用说明.md"

rm -f "$DMG_PATH"
/usr/bin/hdiutil create -volname "YDL S4 Offline" -srcfolder "$VOLUME_DIR" -ov -format UDZO "$DMG_PATH"
/usr/bin/shasum -a 256 "$DMG_PATH" > "$DMG_PATH.sha256"
echo "已生成：$DMG_PATH"
echo "校验：  $DMG_PATH.sha256"

