package online.yellowdogsleague.client;

import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class UpdateClient {
    private final MainActivity activity;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private boolean busy,waitingPermission;
    private volatile boolean closed,cancelled;
    private Release pending;
    private ProgressDialog progress;
    private static final class Release {
        final long code,size;final String name,url,sha,notes;
        Release(JSONObject json){code=json.optLong("versionCode",-1);size=json.optLong("sizeBytes",-1);name=json.optString("versionName","");url=json.optString("apkUrl","");sha=json.optString("sha256","");notes=json.optString("notes","");}
    }
    UpdateClient(MainActivity activity){this.activity=activity;}
    private void ui(Runnable work){activity.runOnUiThread(()->{if(!closed&&!activity.isFinishing()&&!activity.isDestroyed())work.run();});}
    private HttpURLConnection connection(String address) throws Exception {
        for(int redirect=0;redirect<4;redirect++){
            if(!UpdatePolicy.sameOrigin(BuildConfig.UPDATE_URL,address))throw new IllegalArgumentException("更新地址校验失败");
            HttpURLConnection c=(HttpURLConnection)URI.create(address).toURL().openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setUseCaches(false);c.setRequestProperty("Accept-Encoding","identity");c.setRequestProperty("User-Agent","YellowDogsAndroid/"+BuildConfig.VERSION_NAME);
            int status=c.getResponseCode();
            if(status>=300&&status<400){String location=c.getHeaderField("Location");c.disconnect();if(location==null)throw new IllegalArgumentException("更新地址重定向无效");address=URI.create(address).resolve(location).toString();continue;}
            if(status!=200){c.disconnect();throw new IllegalStateException("更新服务器返回 "+status);}
            return c;
        }throw new IllegalStateException("更新地址重定向过多");
    }
    void check(boolean automatic){
        if(busy||closed)return;busy=true;
        worker.execute(()->{try{
            HttpURLConnection c=connection(BuildConfig.UPDATE_URL);byte[] bytes;
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>UpdatePolicy.MAX_MANIFEST_BYTES)throw new IllegalArgumentException("更新信息过大");out.write(buffer,0,n);}bytes=out.toByteArray();
            }finally{c.disconnect();}
            Release release=new Release(new JSONObject(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)));
            if(release.code<=BuildConfig.VERSION_CODE){ui(()->{busy=false;if(!automatic)activity.toast("已是最新客户端；游戏内容随服务器更新");});return;}
            UpdatePolicy.requireRelease(BuildConfig.UPDATE_URL,BuildConfig.VERSION_CODE,release.code,release.url,release.sha,release.size);
            ui(()->{busy=false;new AlertDialog.Builder(activity).setTitle("发现新版本 "+release.name).setMessage(release.notes+"\n\n下载后由系统确认安装，账号数据会保留。").setPositiveButton("下载并更新",(d,w)->download(release)).setNegativeButton("稍后",null).show();});
        }catch(Exception e){ui(()->{busy=false;if(!automatic)activity.toast("暂时无法检查更新："+e.getMessage());});}});
    }
    private File apk(){return new File(activity.getCacheDir(),"verified-client.apk");}
    private void download(Release release){
        if(busy||closed)return;busy=true;cancelled=false;
        progress=new ProgressDialog(activity);progress.setTitle("下载客户端");progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);progress.setMax(100);progress.setCancelable(true);progress.setOnCancelListener(d->cancelled=true);progress.show();
        worker.execute(()->{File temp=new File(activity.getCacheDir(),"client-download.tmp");try{
            HttpURLConnection c=connection(release.url);
            try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(temp)){
                long header=c.getContentLengthLong();if(header>=0&&header!=release.size)throw new IllegalArgumentException("安装包长度不匹配");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[32768];long total=0;int n,last=-1;
                while((n=in.read(buffer))!=-1){if(cancelled||closed)throw new InterruptedException("已取消下载");total+=n;if(total>release.size)throw new IllegalArgumentException("安装包超出声明大小");out.write(buffer,0,n);digest.update(buffer,0,n);int percent=(int)(total*100/release.size);if(percent!=last){last=percent;ui(()->progress.setProgress(percent));}}
                if(total!=release.size||!UpdatePolicy.hex(digest.digest()).equalsIgnoreCase(release.sha))throw new IllegalArgumentException("安装包校验失败，请重新下载");out.getFD().sync();
            }finally{c.disconnect();}
            verifyPackage(temp,release);
            if(cancelled||closed)throw new InterruptedException("已取消下载");
            Files.move(temp.toPath(),apk().toPath(),StandardCopyOption.REPLACE_EXISTING);
            ui(()->{busy=false;progress.dismiss();pending=release;install();});
        }catch(Exception e){temp.delete();ui(()->{busy=false;progress.dismiss();if(!cancelled)activity.toast("更新失败："+e.getMessage());});}});
    }
    @SuppressWarnings("deprecation") private Set<String> signers(PackageInfo info){
        Set<String> result=new HashSet<>();if(info==null)return result;
        Signature[] signatures=Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;
        if(signatures!=null)for(Signature signature:signatures)result.add(signature.toCharsString());return result;
    }
    @SuppressWarnings("deprecation") private void verifyPackage(File file,Release release) throws Exception {
        PackageManager pm=activity.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo next=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags),current=pm.getPackageInfo(activity.getPackageName(),flags);
        long version=next==null?-1:Build.VERSION.SDK_INT>=28?next.getLongVersionCode():next.versionCode;
        Set<String> expected=signers(current);
        if(next==null||!activity.getPackageName().equals(next.packageName)||version!=release.code||expected.isEmpty()||!expected.equals(signers(next)))throw new IllegalArgumentException("安装包身份或签名不匹配");
    }
    private void install(){
        if(pending==null||closed)return;
        if(!activity.getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(activity).setTitle("允许更新客户端").setMessage("请在系统设置中允许黄狗风云安装更新，返回后继续。")
                .setPositiveButton("去设置",(d,w)->{try{waitingPermission=true;activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));}catch(Exception e){waitingPermission=false;activity.toast("无法打开安装权限设置");}}).setNegativeButton("稍后",null).show();return;
        }
        // Revalidate bytes and signing identity after returning from Settings.
        if(busy)return;busy=true;Release release=pending;
        worker.execute(()->{try{
            MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(apk())){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}
            if(apk().length()!=release.size||!UpdatePolicy.hex(digest.digest()).equalsIgnoreCase(release.sha))throw new IllegalArgumentException("安装包已变化，请重新下载");verifyPackage(apk(),release);
            ui(()->{busy=false;Uri uri=Uri.parse("content://"+activity.getPackageName()+".updates/client.apk");Intent intent=new Intent(Intent.ACTION_VIEW);intent.setDataAndType(uri,"application/vnd.android.package-archive");intent.setClipData(ClipData.newRawUri("update",uri));intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);try{activity.startActivity(intent);pending=null;}catch(Exception e){activity.toast("无法启动系统安装程序");}});
        }catch(Exception e){ui(()->{busy=false;pending=null;activity.toast(e.getMessage());});}});
    }
    void resumeInstall(){if(waitingPermission){waitingPermission=false;if(activity.getPackageManager().canRequestPackageInstalls())install();else activity.toast("尚未允许安装，可从菜单重新检查更新");}}
    void close(){closed=true;cancelled=true;worker.shutdownNow();if(progress!=null)progress.dismiss();}
}
