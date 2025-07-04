const QRCode = require('qrcode');
const Jimp = require('jimp');

module.exports = {
  // Generate new QR code
  async generateQR(ticketData) {
    const qrData = `ESWATICKET:${ticketData.event}:${
      ticketData.owner
    }:${Date.now()}`;
    const qrImage = await QRCode.toDataURL(qrData);
    return { qrData, qrImage };
  },

  // Extract data from QR image
  async decodeQR(qrImage) {
    try {
      // 1. Convert Base64 to buffer
      const base64Data = qrImage.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // 2. Read image with Jimp
      const image = await Jimp.read(buffer);
      const qrCode = await image.getBase64Async(Jimp.MIME_PNG);

      // 3. Return both image and extracted data
      return {
        image: qrCode,
        data: qrImage.match(/ESWATICKET:[^"]+/)?.[0] || null,
      };
    } catch (err) {
      console.error('QR decoding failed:', err);
      return { error: 'Invalid QR code image' };
    }
  },
};
