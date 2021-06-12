import * as THREE from "three";

export default class BlitPosition {
    constructor(renderer, scene, camera) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { type: "t", value: null }
            },
            
            vertexShader: `
                varying vec3 vPosition;

                void main() {
                    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;  
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);    
                }
            `,

            fragmentShader: `
                varying vec3 vPosition;

                void main() {
                    gl_FragColor = vec4(vPosition, 1.0);
                }
            `,
        });

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
    }

    blitPosition(renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.scene.overrideMaterial = this.material;
        this.renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = null;

        this.renderer.setRenderTarget(null);
    }
}