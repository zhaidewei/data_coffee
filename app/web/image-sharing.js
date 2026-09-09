export async function copyPng(blob,clipboard=globalThis.navigator?.clipboard,Item=globalThis.ClipboardItem){
 if(!clipboard?.write||!Item)throw new Error('当前浏览器不支持复制图片，请下载后使用。');
 await clipboard.write([new Item({'image/png':blob})]);
}
export async function sharePng(file,navigator=globalThis.navigator){
 await navigator.share({files:[file]});
}
