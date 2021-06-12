import * as THREE from "three";

export default function DoubleRT(w, h, filtering, multisample) {
    let rt1 = new (multisample ? THREE.WebGLRenderTarget : THREE.WebGLMultisampleRenderTarget)(w, h, {
        type:          THREE.FloatType,
        minFilter:     filtering || THREE.LinearFilter,
        magFilter:     filtering || THREE.LinearFilter,
        wrapS:         THREE.ClampToEdgeWrapping,
        wrapT:         THREE.ClampToEdgeWrapping,
        format:        THREE.RGBAFormat,
        stencilBuffer: false,
        anisotropy:    1,
    });

    let rt2 = new (multisample ? THREE.WebGLRenderTarget : THREE.WebGLMultisampleRenderTarget)(w, h, {
        type:          THREE.FloatType,
        minFilter:     filtering || THREE.LinearFilter,
        magFilter:     filtering || THREE.LinearFilter,
        wrapS:         THREE.ClampToEdgeWrapping,
        wrapT:         THREE.ClampToEdgeWrapping,
        format:        THREE.RGBAFormat,
        stencilBuffer: false,
        anisotropy:    1,
    });

    return {
        read:  rt1,
        write: rt2,
        swap: function() {
            let temp   = this.read;
            this.read  = this.write;
            this.write = temp;
        },
        setSize: function(w, h) {
            rt1.setSize(w, h);
            rt2.setSize(w, h);
        },
    };
}