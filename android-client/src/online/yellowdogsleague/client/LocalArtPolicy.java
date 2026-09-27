package online.yellowdogsleague.client;
import java.net.URI;
public final class LocalArtPolicy {
 public static String[] request(String origin,String url){
  try{if(!UpdatePolicy.sameOrigin(origin,url))return null;URI u=URI.create(url);String path=u.getPath();if(path.startsWith("/versus/"))path=path.substring(7);if(!path.startsWith("/assets/")||path.contains("\\")||path.contains("%")||path.contains("/.")||path.contains("//")||path.contains("/admin/")||!path.matches("(?i).*\\.(png|jpg|jpeg|webp|svg|ico|woff|woff2|glb)$"))return null;
   String query=u.getRawQuery(),hash="";if(query!=null){if(!query.matches("v=sha256-[a-f0-9]{64}"))return null;hash=query.substring(9);}return new String[]{path.substring(1),hash};
  }catch(Exception e){return null;}
 }
 private LocalArtPolicy(){}
}
