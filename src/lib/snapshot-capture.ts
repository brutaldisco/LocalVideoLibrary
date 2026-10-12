export async function captureVideoFrame(
  video: HTMLVideoElement,
): Promise<Blob> {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    throw new Error("Wait until the picture appears");
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not capture this frame");
  }

  try {
    ctx.drawImage(video, 0, 0);
  } catch {
    throw new Error("Could not capture this frame");
  }

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Could not capture this frame"));
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        0.92,
      );
    } catch {
      reject(new Error("Could not capture this frame"));
    }
  });
}
