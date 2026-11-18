import mongoose from "mongoose";

// Certificate images live inside MongoDB (GridFS) so they survive redeploys and need no disk.
// Bucket name is unchanged from the standalone Certificate Studio, so migrated images keep working.
const BUCKET = "certimages";
const isObjectId = (s) => /^[a-f0-9]{24}$/i.test(String(s));

let bucket;
const getBucket = () => (bucket ||= new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET }));
const filesCol = () => mongoose.connection.db.collection(`${BUCKET}.files`);

// Stores the image inside MongoDB and returns its id as a string.
export function saveImage(buffer, contentType, filename) {
  return new Promise((resolve, reject) => {
    const up = getBucket().openUploadStream(filename || "certificate", { contentType });
    up.on("error", reject);
    up.on("finish", () => resolve(up.id.toString()));
    up.end(buffer);
  });
}

export async function deleteImage(ref) {
  if (!ref || !isObjectId(ref)) return;
  try {
    await getBucket().delete(new mongoose.Types.ObjectId(ref));
  } catch {
    /* already gone */
  }
}

export async function imageExists(ref) {
  if (!isObjectId(ref)) return false;
  return (await filesCol().countDocuments({ _id: new mongoose.Types.ObjectId(ref) })) > 0;
}

// Express handler for GET /image/:ref (mounted behind the hub's login + app check).
// An image id never changes (replacing an image stores a NEW id), so it can be cached hard.
export async function serveImage(req, res, next) {
  try {
    const { ref } = req.params;
    if (!isObjectId(ref)) return res.status(404).json({ error: "Image not found" });
    const file = await filesCol().findOne({ _id: new mongoose.Types.ObjectId(ref) });
    if (!file) return res.status(404).json({ error: "Image not found" });
    res.setHeader("Cache-Control", "private, max-age=604800, immutable");
    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Content-Length", file.length);
    getBucket().openDownloadStream(file._id).on("error", next).pipe(res);
  } catch (e) {
    next(e);
  }
}
