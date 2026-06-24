import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

/**
 * Uploads a base64-encoded image string to Cloudinary and returns the secure public URL.
 * @param base64Str Base64 image string (optionally containing the data:image/*;base64 header)
 */
export async function uploadToCloudinary(base64Str: string): Promise<string> {
  let dataUri = base64Str.trim();
  
  // If it's a raw base64 string without data prefix, prepend it
  if (!dataUri.startsWith('data:')) {
    dataUri = `data:image/jpeg;base64,${dataUri}`;
  }

  try {
    const uploadResponse = await cloudinary.uploader.upload(dataUri, {
      folder: 'naam_tamilar_katchi_posts',
    });
    return uploadResponse.secure_url;
  } catch (error: any) {
    console.error('Error uploading image to Cloudinary:', error);
    throw new Error(`Failed to upload image to Cloudinary: ${error.message || error}`);
  }
}
