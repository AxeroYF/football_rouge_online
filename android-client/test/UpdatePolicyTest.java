package online.yellowdogsleague.client;

public final class UpdatePolicyTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("Check " + checks); }
    private static void rejects(Runnable test) { try {test.run();}catch(IllegalArgumentException e){checks++;return;}throw new AssertionError("Expected rejection"); }
    public static void main(String[] args) {
        String origin="https://yellowdogsleague.online/android/releases/latest.json",good="https://yellowdogsleague.online/android/releases/app.apk",sha=new String(new char[64]).replace('\0','a');
        check(UpdatePolicy.sameOrigin(origin,good));check(UpdatePolicy.sameOrigin(origin,"https://YELLOWDOGSLEAGUE.ONLINE:443/app.apk"));
        for(String url:new String[]{"http://yellowdogsleague.online/a.apk","https://yellowdogsleague.online.evil.test/a.apk","https://evil.test/a.apk","https://name@yellowdogsleague.online/a.apk","https://yellowdogsleague.online:444/a.apk","file:///tmp/a.apk","javascript:alert(1)","//yellowdogsleague.online/a.apk","https://yellowdogsleague.online/a.apk#fragment","%invalid"})check(!UpdatePolicy.sameOrigin(origin,url));
        check(UpdatePolicy.sameWebOrigin(origin,"https://yellowdogsleague.online/versus/#tactics"));
        check(!UpdatePolicy.sameOrigin(origin,"https://yellowdogsleague.online/versus/#tactics"));
        check(!UpdatePolicy.sameWebOrigin(origin,"https://yellowdogsleague.online.evil.test/#tactics"));
        check(!UpdatePolicy.sameWebOrigin(origin,"https://name@yellowdogsleague.online/#tactics"));
        check(!UpdatePolicy.sameWebOrigin(origin,"http://yellowdogsleague.online/#tactics"));
        check(!UpdatePolicy.sameOrigin(origin,null));check(!UpdatePolicy.sameWebOrigin(null,good));
        UpdatePolicy.requireRelease(origin,1,2,good,sha,100);checks++;
        for(long version:new long[]{-1,0,1,2100000001L})rejects(()->UpdatePolicy.requireRelease(origin,1,version,good,sha,100));
        for(long size:new long[]{-1,0,UpdatePolicy.MAX_APK_BYTES+1})rejects(()->UpdatePolicy.requireRelease(origin,1,2,good,sha,size));
        for(String digest:new String[]{"", "bad", new String(new char[64]).replace('\0','z')})rejects(()->UpdatePolicy.requireRelease(origin,1,2,good,digest,100));
        rejects(()->UpdatePolicy.requireRelease(origin,1,2,"https://other.test/a.apk",sha,100));
        check(UpdatePolicy.hex(new byte[]{0,1,15,16,-1}).equals("00010f10ff"));
        System.out.println("Update policy: "+checks+" checks passed");
    }
}
