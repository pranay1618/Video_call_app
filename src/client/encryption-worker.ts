

interface TransformFrame {
  data: ArrayBuffer;
  timestamp: number;
  type?: string;
}

class FrameEncryptor {
  private key: Uint8Array;

  constructor(key: string) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    this.key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      this.key[i] = keyData[i % keyData.length];
    }
  }

  encrypt(data: ArrayBuffer): ArrayBuffer {
    const view = new Uint8Array(data);
    const encrypted = new Uint8Array(view.length);
    
    for (let i = 0; i < view.length; i++) {
      encrypted[i] = view[i] ^ this.key[i % this.key.length];
    }
    
    return encrypted.buffer;
  }

  decrypt(data: ArrayBuffer): ArrayBuffer {
    return this.encrypt(data);
  }
}

let encryptor: FrameEncryptor | null = null;

self.onrtctransform = (event: any) => {
  const transformer = event.transformer;
  const options = event.transformer.options;
  
  if (!encryptor) {
    const encryptionKey = options.encryptionKey || 'default-secure-key-12345';
    encryptor = new FrameEncryptor(encryptionKey);
  }

  const transformStream = new TransformStream({
    transform: async (encodedFrame: any, controller: TransformStreamDefaultController) => {
      try {
        // Get the frame data
        const data = encodedFrame.data;
        
        let transformedData: ArrayBuffer;
        
        if (options.operation === 'encrypt') {
          // Encrypt outgoing frames
          transformedData = encryptor!.encrypt(data);
        } else if (options.operation === 'decrypt') {
          transformedData = encryptor!.decrypt(data);
        } else {
          transformedData = data;
        }
        encodedFrame.data = transformedData;
        controller.enqueue(encodedFrame);
      } catch (error) {
        console.error('Transform error:', error);
        controller.enqueue(encodedFrame);
      }
    }
  });

  // Pipe frames through the transform
  transformer.readable
    .pipeThrough(transformStream)
    .pipeTo(transformer.writable)
    .catch((error: Error) => {
      console.error('Pipeline error:', error);
    });
};

// Message handler for worker
self.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'init') {
    console.log('Encryption worker initialized');
  }
};
