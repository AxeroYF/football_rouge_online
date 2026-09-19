package online.yellowdogsleague.client;

import java.net.URI;
import java.util.Locale;

/** Pure policy shared by the network updater and JVM regression checks. */
public final class UpdatePolicy {
    public static final long MAX_APK_BYTES = 64L * 1024 * 1024;
    public static final int MAX_MANIFEST_BYTES = 64 * 1024;
    public static boolean sameOrigin(String expected, String candidate) {
        return matchesOrigin(expected, candidate, false);
    }
    public static boolean sameWebOrigin(String expected, String candidate) {
        return matchesOrigin(expected, candidate, true);
    }
    private static boolean matchesOrigin(String expected, String candidate, boolean allowFragment) {
        try {
            URI a = URI.create(expected), b = URI.create(candidate);
            return "https".equalsIgnoreCase(a.getScheme()) && "https".equalsIgnoreCase(b.getScheme())
                && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost())
                && port(a) == port(b) && b.getRawUserInfo() == null
                && (allowFragment || b.getRawFragment() == null);
        } catch (IllegalArgumentException | NullPointerException e) { return false; }
    }
    private static int port(URI u) { return u.getPort() == -1 ? 443 : u.getPort(); }
    public static void requireRelease(String origin, long current, long next, String url, String sha, long size) {
        if (next <= current || next > 2100000000L) throw new IllegalArgumentException("版本号无效");
        if (!sameOrigin(origin, url)) throw new IllegalArgumentException("更新地址不属于游戏服务器");
        if (sha == null || !sha.matches("[a-fA-F0-9]{64}")) throw new IllegalArgumentException("更新校验码无效");
        if (size < 1 || size > MAX_APK_BYTES) throw new IllegalArgumentException("安装包大小无效");
    }
    public static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    private UpdatePolicy() {}
}
