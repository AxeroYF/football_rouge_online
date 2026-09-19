package online.yellowdogsleague.client;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private WebView web;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private TextView errorText;
    private UpdateClient updates;
    private ValueCallback<Uri[]> fileCallback;
    private long lastCheck;
    private boolean navigationFailed;
    private static final int FILE_PICKER = 41;
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(16,25,20));
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(safe.left,safe.top,safe.right,safe.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(12),0,dp(4),0);
        TextView title = new TextView(this); title.setText("黄狗风云"); title.setTextColor(0xffeee6d5); title.setTextSize(14);
        bar.addView(title,new LinearLayout.LayoutParams(0,-1,1));title.setGravity(Gravity.CENTER_VERTICAL);
        Button menu = new Button(this); menu.setText("⋮"); menu.setTextSize(20); menu.setContentDescription("客户端菜单"); menu.setMinHeight(0);menu.setMinimumHeight(0);menu.setPadding(0,0,0,0);
        bar.addView(menu,new LinearLayout.LayoutParams(dp(48),dp(36)));root.addView(bar,new LinearLayout.LayoutParams(-1,dp(36)));
        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(2)));
        FrameLayout content = new FrameLayout(this);root.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        web = new WebView(this);web.setBackgroundColor(0xff101914);content.addView(web,new FrameLayout.LayoutParams(-1,-1));
        errorPanel = new LinearLayout(this);errorPanel.setOrientation(LinearLayout.VERTICAL);errorPanel.setGravity(Gravity.CENTER);errorPanel.setPadding(dp(24),dp(12),dp(24),dp(12));errorPanel.setBackgroundColor(0xff101914);
        errorText = new TextView(this);errorText.setTextColor(0xffeee6d5);errorText.setTextSize(17);errorText.setGravity(Gravity.CENTER);errorPanel.addView(errorText);
        Button retry = new Button(this);retry.setText("重新连接");retry.setOnClickListener(v->loadGame());errorPanel.addView(retry);errorPanel.setVisibility(View.GONE);content.addView(errorPanel,new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setTextZoom(100);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);settings.setBuiltInZoomControls(false);settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(UpdatePolicy.sameWebOrigin(BuildConfig.GAME_URL,url))return false;
                if(request.isForMainFrame()&&request.hasGesture()&&"https".equals(request.getUrl().getScheme())) {
                    try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(Exception e){toast("无法打开外部链接");}
                }
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){navigationFailed=false;errorPanel.setVisibility(View.GONE);progress.setVisibility(View.VISIBLE);}
            @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);CookieManager.getInstance().flush();if(!navigationFailed){errorPanel.setVisibility(View.GONE);applyLandscapeLayout(view,url);}}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showError("暂时无法连接游戏服务器\n请检查网络后重试");}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame())showError("游戏服务器返回 "+response.getStatusCode()+"\n请稍后重试或联系服主");}
            @Override public boolean onRenderProcessGone(WebView view,android.webkit.RenderProcessGoneDetail detail){
                android.view.ViewParent parent=view.getParent();if(parent instanceof android.view.ViewGroup)((android.view.ViewGroup)parent).removeView(view);
                view.destroy();if(web==view)web=null;
                showError("画面暂时中断\n点击重新连接继续游戏");return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int n){progress.setProgress(n);}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
                try{startActivityForResult(intent,FILE_PICKER);}catch(Exception e){fileCallback.onReceiveValue(null);fileCallback=null;toast("无法打开文件选择器");}return true;
            }
        });
        updates=new UpdateClient(this);menu.setOnClickListener(v->{PopupMenu popup=new PopupMenu(this,menu);
            popup.getMenu().add("检查更新 · "+BuildConfig.VERSION_NAME).setOnMenuItemClickListener(item->{updates.check(false);return true;});
            popup.getMenu().add("重新连接").setOnMenuItemClickListener(item->{new AlertDialog.Builder(this).setMessage("重新加载游戏页面？未保存的操作可能丢失。").setPositiveButton("重新连接",(d,w)->loadGame()).setNegativeButton("取消",null).show();return true;});
            popup.getMenu().add("退出游戏").setOnMenuItemClickListener(item->{confirmExit();return true;});popup.show();});
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::goBack);
        if(saved==null||web.restoreState(saved)==null)loadGame();
    }
    private void applyLandscapeLayout(WebView view,String url){
        if(!UpdatePolicy.sameWebOrigin(BuildConfig.GAME_URL,url))return;
        // CSS only: no native JavaScript bridge and no access to account fields.
        view.evaluateJavascript("(()=>{document.documentElement.setAttribute('data-ydl-android','');let s=document.getElementById('ydl-android-layout');if(!s){s=document.createElement('style');s.id='ydl-android-layout';document.head.appendChild(s);}s.textContent="+org.json.JSONObject.quote(BuildConfig.LANDSCAPE_CSS)+";})()",null);
    }
    private void loadGame(){if(web==null){recreate();return;}errorPanel.setVisibility(View.GONE);web.loadUrl(BuildConfig.GAME_URL);}
    private void showError(String text){navigationFailed=true;errorText.setText(text);errorPanel.setVisibility(View.VISIBLE);progress.setVisibility(View.GONE);}
    void toast(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    private void confirmExit(){new AlertDialog.Builder(this).setMessage("退出黄狗风云？").setPositiveButton("退出",(d,w)->finish()).setNegativeButton("继续游戏",null).show();}
    private void goBack(){if(web!=null&&web.canGoBack())web.goBack();else confirmExit();}
    @Override public void onBackPressed(){goBack();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==FILE_PICKER&&fileCallback!=null){fileCallback.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);fileCallback=null;}}
    @Override protected void onSaveInstanceState(Bundle out){if(web!=null)web.saveState(out);super.onSaveInstanceState(out);}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();
        if(Build.VERSION.SDK_INT>=30){WindowInsetsController controller=getWindow().getInsetsController();if(controller!=null){controller.hide(WindowInsets.Type.systemBars());controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);}}
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        if(updates!=null){updates.resumeInstall();long now=System.currentTimeMillis();if(now-lastCheck>6*60*60*1000L){lastCheck=now;updates.check(true);}}
    }
    @Override protected void onPause(){if(web!=null){web.onPause();CookieManager.getInstance().flush();}super.onPause();}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);if(updates!=null)updates.close();if(web!=null){((android.view.ViewGroup)web.getParent()).removeView(web);web.destroy();}super.onDestroy();}
}
