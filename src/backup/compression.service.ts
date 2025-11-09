import { Injectable, Logger } from '@nestjs/common';
import { Transform, pipeline } from 'stream';
import { createBrotliCompress, createBrotliDecompress, constants } from 'zlib';

@Injectable()
export class CompressionService {
  private readonly logger = new Logger(CompressionService.name);

  createCompressStream(level = 6): Transform {
    return createBrotliCompress({
      params: {
        [constants.BROTLI_PARAM_QUALITY]: level,
      },
    });
  }

  createDecompressStream(): Transform {
    return createBrotliDecompress();
  }
}
