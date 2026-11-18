import sharp from 'sharp';
export async function imageMetrics(file){
 const m=await sharp(file).metadata();const {data,info}=await sharp(file).resize({width:500,height:500,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let l=info.width,t=info.height,r=0,b=0,clear=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){if(data[(y*info.width+x)*4+3]>24){l=Math.min(l,x);r=Math.max(r,x+1);t=Math.min(t,y);b=Math.max(b,y+1);}else clear++;}
 return {width:m.width,height:m.height,hasAlpha:!!m.hasAlpha,transparentFraction:clear/(info.width*info.height),foreground:{width:Math.round((r-l)*m.width/info.width),height:Math.round((b-t)*m.height/info.height)},bounds:{width:info.width,height:info.height,left:l,top:t,right:r,bottom:b}};
}
export async function assessArt({file,source,visualNote,reviewed=true}){
 const asset=await imageMetrics(file),original=source.originalFile?await imageMetrics(source.originalFile):asset,aiEdited=!!source.edit;
 const effective=aiEdited?null:original.foreground;const dimensions=effective??original;
 const long=Math.max(dimensions.width,dimensions.height),short=Math.min(dimensions.width,dimensions.height);
 const resolution=long>=1000&&short>=500?'R1':long>=500&&short>=250?'R2':'R3';
 const identity=source.type==='existing-user-art'?'I1 历史球员 ID 映射一致':'I2 来源页实名匹配';
 const reasons=[];if(aiEdited)reasons.push('AI 抠图可能重绘细节，必须复核；输出放大不计入原始清晰度');
 if(!aiEdited&&resolution==='R2')reasons.push('人物有效像素中等，适合小卡展示');if(!aiEdited&&resolution==='R3')reasons.push('人物有效像素偏低，放大易模糊');
 if(visualNote)reasons.push(visualNote.note);if(source.qualityNote&&!aiEdited&&!reasons.includes(source.qualityNote))reasons.push(source.qualityNote.replace('Low resolution source: seek higher resolution before final inclusion','原素材仅 256×256，建议后续换高清图'));
 let level=aiEdited||resolution==='R3'?'Q3':resolution==='R1'?'Q1':'Q2';
 if(visualNote?.level&&visualNote.level>level)level=visualNote.level;if(!reviewed)level='Q0';
 return {level,label:({Q1:'优选',Q2:'可用',Q3:'重点复核',Q0:'未复核'})[level],identity,sourceResolution:{width:original.width,height:original.height},sourceResolutionMeaning:source.type==='existing-user-art'?'找回的历史文件尺寸；更早相机原图未知':'下载源文件尺寸；不证明上游从未放大',effectiveForegroundResolution:effective,assetResolution:{width:asset.width,height:asset.height},resolutionLevel:aiEdited?'R?':resolution,transparent:asset.hasAlpha&&asset.transparentFraction>.01,transparentFraction:asset.transparentFraction,aiEdited,visualLevel:aiEdited?'V3 AI 细节待确认':visualNote?'V2 有已记录构图问题':'V1 联系表未见明显缺陷',reasons,positionStatus:'待用户手动精调',reviewStatus:reviewed?'来源字段核对 + 联系表可见缺陷检查（非逐像素或生物识别验证）':'未复核'};
}
