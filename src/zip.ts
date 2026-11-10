import { crc32, deflateRawSync } from "node:zlib";

export type ZipFile = { name: string; data: Buffer | string };

// A minimal ZIP writer (deflate, UTF-8 names, no ZIP64): enough for an archive of notes and covers.
export function zip(files: ZipFile[], now = new Date()): Buffer {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data);
    const packed = deflateRawSync(data);
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version needed
    common.writeUInt16LE(0x0800, 2); // names are UTF-8
    common.writeUInt16LE(8, 4); // deflate
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from("PK\x03\x04"), common, name, packed]);
    const entry = Buffer.alloc(42);
    entry.writeUInt16LE(20, 0); // version made by
    common.copy(entry, 2, 0, 24);
    entry.writeUInt32LE(offset, 38);
    directory.push(Buffer.concat([Buffer.from("PK\x01\x02"), entry, name]));
    parts.push(local);
    offset += local.length;
  }
  const size = directory.reduce((sum, d) => sum + d.length, 0);
  const end = Buffer.alloc(18);
  end.writeUInt16LE(files.length, 4); // entries on this disk
  end.writeUInt16LE(files.length, 6); // entries in total
  end.writeUInt32LE(size, 8);
  end.writeUInt32LE(offset, 12);
  return Buffer.concat([...parts, ...directory, Buffer.from("PK\x05\x06"), end]);
}
