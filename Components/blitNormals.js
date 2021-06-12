import * as THREE from "three";

export default class BlitNormals {
    constructor(renderer, scene, camera) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { type: "t", value: null }
            },
            
            vertexShader: `
                varying vec3 vNormal;

                void main() {
                    // world space normal
                    vNormal = (transpose(inverse(modelMatrix)) * vec4(normal, 1.0)).xyz;  

                    // view space normal
                    // vNormal = normalMatrix * normal;
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);    
                }
            `,

            fragmentShader: `
                varying vec3 vNormal;

                void main() {
                    gl_FragColor = vec4(normalize(vNormal), 1.0);
                }
            `,
        });

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
    }

    blitNormals(renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.scene.overrideMaterial = this.material;
        this.renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = null;

        this.renderer.setRenderTarget(null);
    }
}