import * as THREE from "three";

export default class BlitDepth {
    constructor(renderer, scene, camera) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { type: "t", value: null }
            },
            
            vertexShader: `
                varying float vDepth;

                void main() {
                    vDepth = - (modelViewMatrix * vec4(position, 1.0)).z;  
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);    
                }
            `,

            fragmentShader: `
                varying float vDepth;

                void main() {
                    gl_FragColor = vec4(vDepth, vDepth, vDepth, 1.0);
                }
            `,
        });

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
    }

    blitDepth(renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.scene.overrideMaterial = this.material;
        this.renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = null;

        this.renderer.setRenderTarget(null);
    }
}