import {it,expect,vi} from 'vitest';
// @ts-ignore browser sharing module
import {copyPng,sharePng} from '../web/image-sharing.js';
it('复制只写入一个PNG项目，不附加HTML或文本',async()=>{const blob=new Blob(['png'],{type:'image/png'});const write=vi.fn().mockResolvedValue(undefined);class Item{constructor(public data:unknown){}}await copyPng(blob,{write},Item);expect(write).toHaveBeenCalledTimes(1);const items=write.mock.calls[0][0];expect(items).toHaveLength(1);expect(items[0].data).toEqual({'image/png':blob});});
it('系统分享只携带一张图片',async()=>{const file=new File(['png'],'invite.png',{type:'image/png'}),share=vi.fn().mockResolvedValue(undefined);await sharePng(file,{share});expect(share).toHaveBeenCalledExactlyOnceWith({files:[file]});});
it('复制失败不会再触发一次写入',async()=>{const write=vi.fn().mockRejectedValue(new Error('denied'));await expect(copyPng(new Blob(),{write},class {})).rejects.toThrow('denied');expect(write).toHaveBeenCalledTimes(1);});
