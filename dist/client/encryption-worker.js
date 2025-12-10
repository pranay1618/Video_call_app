
class FrameEncryptor {
    constructor(key) {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(key);
        this.key = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
            this.key[i] = keyData[i % keyData.length];
        }
    }
    encrypt(data) {
        const view = new Uint8Array(data);
        const encrypted = new Uint8Array(view.length);
        for (let i = 0; i < view.length; i++) {
            encrypted[i] = view[i] ^ this.key[i % this.key.length];
        }
        return encrypted.buffer;
    }
    decrypt(data) {
        return this.encrypt(data);
    }
}
let encryptor = null;
self.onrtctransform = (event) => {
    const transformer = event.transformer;
    const options = event.transformer.options;
    if (!encryptor) {
        const encryptionKey = options.encryptionKey || 'default-secure-key-12345';
        encryptor = new FrameEncryptor(encryptionKey);
    }
    const transformStream = new TransformStream({
        transform: async (encodedFrame, controller) => {
            try {
                const data = encodedFrame.data;
                let transformedData;
                if (options.operation === 'encrypt') {
                    transformedData = encryptor.encrypt(data);
                }
                else if (options.operation === 'decrypt') {
                    transformedData = encryptor.decrypt(data);
                }
                else {
                    transformedData = data;
                }
                encodedFrame.data = transformedData;
                controller.enqueue(encodedFrame);
            }
            catch (error) {
                console.error('Transform error:', error);
                controller.enqueue(encodedFrame);
            }
        }
    });
    transformer.readable
        .pipeThrough(transformStream)
        .pipeTo(transformer.writable)
        .catch((error) => {
        console.error('Pipeline error:', error);
    });
};
self.onmessage = (event) => {
    if (event.data.type === 'init') {
        console.log('Encryption worker initialized');
    }
};
