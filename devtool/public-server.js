process.env.VERSUS_HOST ??= "127.0.0.1";
process.env.DEVTOOL_PORT ??= "4318";
process.env.VERSUS_PUBLIC_ONLY = "1";

await import("./server.js");
