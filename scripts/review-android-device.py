import argparse,subprocess,pathlib,io,json,xml.etree.ElementTree as E
from PIL import Image
ap=argparse.ArgumentParser();ap.add_argument('--name',required=True);ap.add_argument('--tap',nargs=2);ap.add_argument('--back',action='store_true');args=ap.parse_args();adb=['C:/Users/11846/AppData/Local/Android/Sdk/platform-tools/adb.exe','-s','RFCY90BH9CD'];out=pathlib.Path('outputs/android-device-r25');out.mkdir(exist_ok=True)
if args.tap:subprocess.run(adb+['shell','input','tap',*args.tap],check=True)
if args.back:subprocess.run(adb+['shell','input','keyevent','4'],check=True)
subprocess.run(adb+['shell','uiautomator','dump','/sdcard/ydl-review.xml'],capture_output=True,check=True);xml=subprocess.check_output(adb+['shell','cat','/sdcard/ydl-review.xml']);(out/(args.name+'.xml')).write_bytes(xml)
nodes=[dict(text=n.get('text'),description=n.get('content-desc'),bounds=n.get('bounds'),clickable=n.get('clickable')) for n in E.fromstring(xml).iter('node') if n.get('package')=='online.yellowdogsleague.client' and (n.get('text') or n.get('content-desc'))];import re
def large(n):
 v=list(map(int,re.findall(r'\d+',n['bounds'])));return len(v)==4 and v[2]-v[0]>=90 and v[3]-v[1]>=80
print(json.dumps([n for n in nodes if n['clickable']=='true' and large(n)],ensure_ascii=False))
b=subprocess.check_output(adb+['exec-out','screencap','-p']);(out/(args.name+'.png')).write_bytes(b);im=Image.open(io.BytesIO(b));im.thumbnail((1170,1170));im.convert('RGB').save(out/'latest.jpg')
