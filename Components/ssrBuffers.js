import * as THREE from "three";
import DoubleRT from "./doubleRT";
import Utils from "./utils";

export default class SSRBuffers {
    constructor(width, height) {
        this.GBuffer = new THREE.WebGLMultipleRenderTargets(
            width,
            height,
            4
        );
        
        for ( let j = 0, il = GBuffer.texture.length; j < il; j ++ ) {
            GBuffer.texture[ j ].minFilter = THREE.NearestFilter;
            GBuffer.texture[ j ].magFilter = THREE.NearestFilter;
            GBuffer.texture[ j ].type = THREE.FloatType;
        }

        GBuffer.texture[ 0 ].name = 'normal';
        GBuffer.texture[ 1 ].name = 'position';
        GBuffer.texture[ 2 ].name = 'color';
        GBuffer.texture[ 3 ].name = 'material';

        this.bufferMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uRoughness: { value: 1 },
                uMetalness: { value: 1 },
                uColor:     { value: new THREE.Vector3(1,1,1) },

                uRoughnessMap: { type: "t", value: null },
                uMetalnessMap: { type: "t", value: null },
                uColorMap:     { type: "t", value: null },
            },
            
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec2 vUv;
                varying float vDepth;

                void main() {
                    // world space normal
                    vNormal = (transpose(inverse(modelMatrix)) * vec4(normal, 1.0)).xyz;  

                    // view space normal
                    // vNormal = normalMatrix * normal;
                    
                    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;  
                   
                    vDepth = - (modelViewMatrix * vec4(position, 1.0)).z;  

                    vUv = uv;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);    
                }
            `,

            fragmentShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec2 vUv;
                varying float vDepth;

                uniform float uRoughness;
                uniform float uMetalness;
                uniform vec3  uColor;

                uniform sampler2D uRoughnessMap;
                uniform sampler2D uMetalnessMap;
                uniform sampler2D uColorMap;

                void main() {
                    float roughness = texture2D(uRoughnessMap, vUv).x * uRoughness;
                    float metalness = texture2D(uMetalnessMap, vUv).x * uMetalness;
                    vec3 color      = texture2D(uColorMap, vUv).xyz * uColor;

                    gl_FragColor = vec4(roughness, metalness, 0.0, 0.0);
                    gl_FragColor = vec4(roughness, metalness, 0.0, 0.0);
                    gl_FragColor = vec4(vPosition, vDepth);
                    gl_FragColor = vec4(normalize(vNormal), 1.0);
                }
            `,

            side: THREE.DoubleSide,
        });

        this.bufferScene = new THREE.Scene();
    }

    compute(renderer, scene, camera) {
        let autoClearOpt = renderer.autoClear;

        renderer.autoClear = false;
        renderer.setRenderTarget(this.GBuffer);
        renderer.clear();

        for(let i = scene.children.length - 1; i >= 0; i--) {
            let mesh = scene.children[i];

            // if we keep this uncommented we have to take into account that we might have
            // meshes that don't specify some textures / properties we might need
            // if(!mesh.material instanceof SSRMaterial) continue;

            mesh.savedMaterial = mesh.material;
            mesh.material = this.bufferMaterial;
    
            // remember: momentBufferScene will always hold 1 single object each time render() is called
            this.bufferScene.add(mesh);
    
            renderer.render( this.bufferScene, camera );
    
            // reassign original material
            this.bufferScene.children[0].material = this.bufferScene.children[0].savedMaterial;

            // re-add again this object to scene since it was removed by momentBufferScene.add(...)
            // it should also remove the object from momentBufferScene
            scene.add(this.momentBufferScene.children[0]);
        }

        renderer.autoClear = autoClearOpt;
        renderer.setRenderTarget(null);
    }
}