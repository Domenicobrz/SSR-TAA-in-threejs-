import * as THREE from "three";
import { Vector3 } from "three";
import DoubleRT from "./doubleRT";
import Utils from "./utils";
import { defaultWhiteTexture, defaultBlackTexture } from "./defaultTextures";

export default class SSRBuffers {
    constructor(width, height) {
        this.GBuffer = new THREE.WebGLMultipleRenderTargets(
            width,
            height,
            4
        );
        
        for ( let j = 0, il = this.GBuffer.texture.length; j < il; j ++ ) {
            this.GBuffer.texture[ j ].minFilter = THREE.NearestFilter;
            this.GBuffer.texture[ j ].magFilter = THREE.NearestFilter;
            this.GBuffer.texture[ j ].type = THREE.FloatType;
        }

        this.GBuffer.texture[ 0 ].name = 'normal';
        this.GBuffer.texture[ 1 ].name = 'position';
        this.GBuffer.texture[ 2 ].name = 'albedo';
        this.GBuffer.texture[ 3 ].name = 'material';

        this.GTextures = { 
            normal:   this.GBuffer.texture[ 0 ],
            position: this.GBuffer.texture[ 1 ],
            albedo:   this.GBuffer.texture[ 2 ],
            material: this.GBuffer.texture[ 3 ],
        };
        
        this.bufferMaterial = new THREE.RawShaderMaterial({
            uniforms: {
                uRoughness: { value: 1 },
                uMetalness: { value: 1 },
                uBaseF0:    { value: 0.05 },
                uMeshId:    { value: 0 },
                uAlbedo:    { value: new Vector3(1,1,1) },

                uRoughnessMap: { type: "t", value: null },
                uMetalnessMap: { type: "t", value: null },
                uAlbedoMap:    { type: "t", value: null },
            },
            
            vertexShader: `
                in vec3 position;
                in vec3 normal;
                in vec2 uv;

                out vec3 vNormal;
                out vec3 vPosition;
                out vec2 vUv;
                out float vDepth;

                uniform mat4 modelMatrix;
                uniform mat4 modelViewMatrix;
			    uniform mat4 viewMatrix;
			    uniform mat4 projectionMatrix;
			    uniform mat3 normalMatrix;

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
                precision highp float;
                precision highp int;

                in vec3 vNormal;
                in vec3 vPosition;
                in vec2 vUv;
                in float vDepth;

                uniform float uRoughness;
                uniform float uMetalness;
                uniform float uBaseF0;
                uniform float uMeshId;
                uniform vec3  uAlbedo;

                uniform sampler2D uRoughnessMap;
                uniform sampler2D uMetalnessMap;
                uniform sampler2D uAlbedoMap;

                layout(location = 0) out vec4 out_normal;
			    layout(location = 1) out vec4 out_position;
			    layout(location = 2) out vec4 out_albedo;
			    layout(location = 3) out vec4 out_material;

                void main() {
                    float roughness = texture(uRoughnessMap, vUv).x * uRoughness;
                    float metalness = texture(uMetalnessMap, vUv).y * uMetalness;
                    vec3 albedo     = texture(uAlbedoMap, vUv).xyz * uAlbedo;

                    out_normal      = vec4(normalize(vNormal), 1.0);
                    out_position    = vec4(vPosition, vDepth);
                    out_albedo      = vec4(albedo, 0.0);
                    out_material    = vec4(roughness, metalness, uBaseF0, uMeshId);
                }
            `,

            glslVersion: THREE.GLSL3,
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
            
            // pointlights don't have materials assigned
            if(!mesh.material) continue;

            mesh.savedMaterial = mesh.material;
            mesh.material = this.bufferMaterial;
            mesh.material.uniforms.uAlbedoMap.value    = mesh.savedMaterial.map          || defaultWhiteTexture;
            mesh.material.uniforms.uRoughnessMap.value = mesh.savedMaterial.roughnessMap || defaultWhiteTexture;
            mesh.material.uniforms.uMetalnessMap.value = mesh.savedMaterial.metalnessMap || defaultWhiteTexture;
            mesh.material.uniforms.uAlbedo.value       = mesh.savedMaterial.color     || new Vector3(1,1,1);
            mesh.material.uniforms.uRoughness.value    = mesh.savedMaterial.roughness || 1;
            mesh.material.uniforms.uMetalness.value    = mesh.savedMaterial.metalness || 0;
            mesh.material.uniforms.uBaseF0.value       = mesh.savedMaterial.baseF0 || 0.05;
            mesh.material.uniforms.uMeshId.value       = mesh.savedMaterial.meshId || 0;
    
            // remember: momentBufferScene will always hold 1 single object each time render() is called
            this.bufferScene.add(mesh);
    
            renderer.render( this.bufferScene, camera );
    
            // reassign original material
            this.bufferScene.children[0].material = this.bufferScene.children[0].savedMaterial;

            // re-add again this object to scene since it was removed by momentBufferScene.add(...)
            // it should also remove the object from momentBufferScene
            scene.add(this.bufferScene.children[0]);
        }

        renderer.autoClear = autoClearOpt;
        renderer.setRenderTarget(null);
    }
}