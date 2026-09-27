package online.yellowdogsleague.client;
import android.content.Context;
import android.webkit.WebResourceResponse;
import android.util.Log;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.GZIPInputStream;

/** Only public, matching art is intercepted. HTML, code, API and uploads stay online. */
public final class LocalArtCache {
 private final Context context;
 private final Map<String,String> bundled;
 private volatile Map<String,String> current=Collections.emptyMap();
 private volatile CountDownLatch ready=new CountDownLatch(0);
 private boolean refreshing;
 private final AtomicLong hits=new AtomicLong();
 private final java.util.concurrent.atomic.AtomicBoolean portraitLogged=new java.util.concurrent.atomic.AtomicBoolean();
 private final File manifestFile,etagFile;
 public LocalArtCache(Context context){
  this.context=context.getApplicationContext();manifestFile=new File(context.getFilesDir(),"art-manifest.json");etagFile=new File(context.getFilesDir(),"art-manifest.etag");
  Map<String,String> seed=Collections.emptyMap();try(InputStream in=context.getAssets().open("local-art/manifest.json")){seed=parse(read(in,12*1024*1024));}catch(Exception e){Log.w("YDLArt","Bundled art unavailable; using HTTP");}bundled=seed;
 }
 private Map<String,String> parse(byte[] bytes)throws Exception{
  JSONObject root=new JSONObject(new String(bytes,"UTF-8"));JSONArray entries=root.getJSONArray("entries");if(root.getInt("schemaVersion")!=1||entries.length()>50000)throw new IOException("Invalid manifest");
  Map<String,String> map=new HashMap<>();for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);String path=e.getString("path"),hash=e.getString("sha256");long size=e.getLong("bytes");if(!hash.matches("[a-f0-9]{64}")||size<0||size>128L*1024*1024)throw new IOException("Invalid entry");if(LocalArtPolicy.request(BuildConfig.GAME_URL,new URI("https","yellowdogsleague.online","/"+path,null).toASCIIString())!=null)map.put(path,hash);}
  return Collections.unmodifiableMap(map);
 }
 private static byte[] read(InputStream in,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>limit)throw new IOException("Response too large");out.write(buffer,0,n);}return out.toByteArray();}
 private static void write(File target,byte[] bytes)throws IOException{File temp=new File(target.getPath()+".tmp");try(FileOutputStream out=new FileOutputStream(temp)){out.write(bytes);}if(!temp.renameTo(target)){temp.delete();throw new IOException("Manifest save failed");}}
 public synchronized void refresh(){
  if(refreshing)return;refreshing=true;final CountDownLatch latch=new CountDownLatch(1);ready=latch;
  new Thread(()->{HttpURLConnection connection=null;try{
   connection=(HttpURLConnection)new URL("https://yellowdogsleague.online/assets/data/desktop-resources.json").openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(4000);connection.setReadTimeout(6000);connection.setRequestProperty("Accept-Encoding","gzip");
   if(manifestFile.isFile()&&etagFile.isFile())try(InputStream in=new FileInputStream(etagFile)){connection.setRequestProperty("If-None-Match",new String(read(in,1024),"UTF-8"));}
   int code=connection.getResponseCode();byte[] bytes;
   if(code==304){try(InputStream in=new FileInputStream(manifestFile)){bytes=read(in,12*1024*1024);}}
   else if(code==200){try(InputStream raw=connection.getInputStream();InputStream in="gzip".equalsIgnoreCase(connection.getContentEncoding())?new GZIPInputStream(raw):raw){bytes=read(in,12*1024*1024);}}
   else throw new IOException("Manifest HTTP "+code);
   Map<String,String> next=parse(bytes);current=next;
   if(code==200){write(manifestFile,bytes);String tag=connection.getHeaderField("ETag");if(tag!=null&&tag.length()<1024)write(etagFile,tag.getBytes("UTF-8"));else etagFile.delete();}
   Log.i("YDLArt","Manifest ready HTTP "+code+"; bundled="+bundled.size());
  }catch(Exception e){current=Collections.emptyMap();etagFile.delete();Log.w("YDLArt","Manifest unavailable; unversioned art uses HTTP");}
  finally{if(connection!=null)connection.disconnect();synchronized(this){refreshing=false;}latch.countDown();}},"ydl-art-manifest").start();
 }
 public WebResourceResponse intercept(String url){
  String[] request=LocalArtPolicy.request(BuildConfig.GAME_URL,url);if(request==null)return null;String path=request[0],seed=bundled.get(path);if(seed==null)return null;
  if(request[1].isEmpty()){try{ready.await(1500,TimeUnit.MILLISECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();return null;}if(!seed.equals(current.get(path)))return null;}else if(!seed.equals(request[1]))return null;
  try{InputStream in=context.getAssets().open("local-art/"+seed);long count=hits.incrementAndGet();if(count==1||count%25==0||(path.startsWith("assets/player-profiles/")&&portraitLogged.compareAndSet(false,true)))Log.i("YDLArt","Local hits="+count+" latest="+path);
   Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Access-Control-Allow-Origin","https://yellowdogsleague.online");headers.put("X-Content-Type-Options","nosniff");headers.put("X-YDL-Resource","apk");return new WebResourceResponse(mime(path),null,200,"OK",headers,in);
  }catch(IOException e){return null;}
 }
 private static String mime(String p){if(p.endsWith(".webp"))return "image/webp";if(p.endsWith(".svg"))return "image/svg+xml";if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return "image/jpeg";if(p.endsWith(".woff2"))return "font/woff2";if(p.endsWith(".woff"))return "font/woff";if(p.endsWith(".glb"))return "model/gltf-binary";if(p.endsWith(".ico"))return "image/x-icon";return "image/png";}
}
