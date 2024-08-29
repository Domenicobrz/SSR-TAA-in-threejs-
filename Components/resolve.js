import * as THREE from "three";
import { Vector2, Vector3 } from "three";
import DoubleRT from "./doubleRT";

export default class Resolve {
  constructor(
    positionTexture,
    normalTexture,
    materialTexture,
    albedoTexture,
    renderer
  ) {
    let sizeVector = new THREE.Vector2();
    renderer.getSize(sizeVector);
    this.sizeVector = sizeVector;

    this.keepRTAtFullRes = true;
    // this.usingLinearIntersectionBuffer = true;

    this.drt = DoubleRT(sizeVector.x, sizeVector.y, THREE.LinearFilter);
    this.rt = new THREE.WebGLRenderTarget(sizeVector.x, sizeVector.y, {
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      stencilBuffer: false,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMaterial: { type: "t", value: materialTexture },
        uPosition: { type: "t", value: positionTexture },
        uNormal: { type: "t", value: normalTexture },
        uAlbedo: { type: "t", value: albedoTexture },
        uSSRColor: { type: "t", value: null },
        uSSRIntersection: { type: "t", value: null },
        uSSRData: { type: "t", value: null },
        uInvScreen: { value: new Vector2(1 / innerWidth, 1 / innerHeight) },
        // this one wont be modified if the SSRT size changes
        uFullInvScreen: { value: new Vector2(1 / innerWidth, 1 / innerHeight) },
        uCameraPos: { value: new Vector3(0, 0, 0) },
        uTaps: { value: 9 },
        uDisableResolve: { value: false },
      },

      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);    
        }
      `,

      fragmentShader: `
        varying vec2 vUv;

        uniform sampler2D uSSRColor;
        uniform sampler2D uSSRIntersection;
        uniform sampler2D uSSRData;
        uniform sampler2D uMaterial;
        uniform sampler2D uPosition;
        uniform sampler2D uNormal;
        uniform sampler2D uAlbedo;

        uniform vec3 uCameraPos;
        uniform vec2 uFullInvScreen;
        uniform vec2 uInvScreen;
        uniform int uTaps;
        uniform bool uDisableResolve;

        #define PI 3.14159

        float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
          float a = roughness * roughness;
          float nv = dot(N, V);
          return (2.0 * nv) / (nv + sqrt(a*a + (1.0 - a*a) * nv * nv ));
          
          // float NdotV = max(dot(N, V), 0.0);
          // float NdotL = max(dot(N, L), 0.0);
          // float ggx2  = GeometrySchlickGGX(NdotV, roughness);
          // float ggx1  = GeometrySchlickGGX(NdotL, roughness);
        
          // return ggx1 * ggx2;
        }

        float DistributionGGX(vec3 N, vec3 H, float roughness) {
          vec3 m = H;
          float a = roughness * roughness;
          float nm2 = pow(dot(N, H), 2.0);
          return (a * a) / (PI * pow( nm2 * ( a * a - 1.0 ) + 1.0, 2.0));
        }

        vec3 fresnelSchlick(float cosTheta, vec3 F0) {
          return F0 + (1.0 - F0) * pow(max(1.0 - cosTheta, 0.0), 5.0);
        }

        // http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
        vec3 EvalBRDF(vec3 wi, vec3 wo, vec3 n, float roughness, vec3 F0) {
          vec3 wm = normalize(wo + wi);
          if (/* (wi.y <= 0.0) || */ dot(wi, wm) <= 0.0) {
            return vec3(0.0);
          }

          vec3 F    = fresnelSchlick(max(dot(wi, n), 0.0), F0);
          float NDF = DistributionGGX(n, wm, roughness); 
          float G   = GeometrySmith(n, wo, wi, roughness);   
          
          // I removed an additional multiplication dot(wi, n) from this line
          // so that I could also remove the initial multiplication for cos theta at the first bounce
          // took the idea from here: http://cwyman.org/code/dxrTutors/tutors/Tutor14/tutorial14.md.html (step 4)
          vec3 specular = (F * NDF * G) / (4.0 * dot(n,wo));  
          return F0 * specular;
          // return specular;
        }

        void tap(
          inout vec3 result, 
          inout vec3 weightSum, vec2 offs, vec3 pos, vec3 norm, 
          float roughness, vec3 F0, vec3 viewDir
        ) {
          vec4 localData = texture2D(uSSRData, vUv + offs);
          vec3 intersectionP = localData.xyz;

          vec3 wi = normalize(intersectionP - pos);
          vec3 wo = -viewDir;

          vec3 localBrdf = EvalBRDF(wi, wo, norm, roughness, F0);
          // same clamping is being done in ssr.js
          localBrdf = clamp(localBrdf, 0.00001, 100.0);
          // vec3 localBrdf = localData.xyz;

          // this one has been clamped directly inside ssr.js
          float pdf = localData.w;

          vec3 weight = localBrdf / pdf;
          result += texture2D(uSSRColor, vUv + offs).xyz * weight;
          weightSum += weight;
          // weightSum = vec3(float(uTaps));
        }

        void main() {
          vec4 posTexel = texture2D(uPosition, vUv);
          vec3 pos      = posTexel.xyz;
          float depth   = posTexel.w;
          vec3 norm     = normalize(texture2D(uNormal, vUv).xyz);
          vec4 material = texture2D(uMaterial, vUv);
          float roughness = material.x;
          float metalness = material.y;
          float baseF0    = material.z;
          float meshId    = material.w;
          vec3 albedo   = texture2D(uAlbedo, vUv).xyz;

          vec3 F0 = vec3(baseF0);
          F0 = mix(F0, albedo.xyz, metalness);

          vec3 viewDir = normalize(pos - uCameraPos);

          vec3 result = vec3(0.0);
          vec3 weightSum = vec3(0.0);

          if (uTaps == 25) {
            for (int i = -2; i <= 2; i++) {
              for (int j = -2; j <= 2; j++) {
                vec2 offs = vec2(i, j) * uInvScreen;
                tap(result, weightSum, offs, pos, norm, roughness, F0, viewDir);
              }
            }
          } else if (uTaps == 9) {
            for (int i = -1; i <= 1; i++) {
              for (int j = -1; j <= 1; j++) {
                vec2 offs = vec2(i, j) * uInvScreen;
                tap(result, weightSum, offs, pos, norm, roughness, F0, viewDir);
              }
            }
          } else if (uTaps == 4) {
            for (int i = 0; i <= 1; i++) {
              for (int j = 0; j <= 1; j++) {
                vec2 offs = vec2(i, j) * uInvScreen;
                tap(result, weightSum, offs, pos, norm, roughness, F0, viewDir);
              }
            }
          }

          result /= weightSum;

          if (uDisableResolve) {
            result = texture2D(uSSRColor, vUv).xyz;
          }
  
          gl_FragColor = vec4(result, 1.0);
        }
      `,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.accumMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { type: "t", value: null },
        uNew: { type: "t", value: null },
        uSamplesCount: { value: 0 },
        uSampleIndex: { value: 0 },
      },

      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);    
        }
      `,

      fragmentShader: `
        varying vec2 vUv;

        uniform sampler2D uPrev;
        uniform sampler2D uNew;
        
        uniform float uSamplesCount;
        uniform int uSampleIndex;

        void main() {
          if (uSampleIndex > 0) {
            gl_FragColor = texture2D(uPrev, vUv) + texture2D(uNew, vUv) * (1.0 / uSamplesCount);
          } else {
            gl_FragColor = texture2D(uNew, vUv) * (1.0 / uSamplesCount);
          }
        }
      `,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(2, 2),
      this.material
    );
    this.mesh.frustumCulled = false;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  setSize(resolution) {
    switch (resolution) {
      case "Quarter":
        this.material.uniforms.uInvScreen.value = new Vector2(
          1 / Math.floor(this.sizeVector.x * 0.25),
          1 / Math.floor(this.sizeVector.y * 0.25)
        );
        break;
      case "Half":
        this.material.uniforms.uInvScreen.value = new Vector2(
          1 / Math.floor(this.sizeVector.x * 0.5),
          1 / Math.floor(this.sizeVector.y * 0.5)
        );
        break;
      case "Full":
        this.material.uniforms.uInvScreen.value = new Vector2(
          1 / this.sizeVector.x,
          1 / this.sizeVector.y
        );
        break;
    }

    if (this.keepRTAtFullRes) return;

    switch (resolution) {
      case "Quarter":
        this.drt.setSize(
          Math.floor(this.sizeVector.x * 0.25),
          Math.floor(this.sizeVector.y * 0.25)
        );
        this.rt.setSize(
          Math.floor(this.sizeVector.x * 0.25),
          Math.floor(this.sizeVector.y * 0.25)
        );
        break;
      case "Half":
        this.drt.setSize(
          Math.floor(this.sizeVector.x * 0.5),
          Math.floor(this.sizeVector.y * 0.5)
        );
        this.rt.setSize(
          Math.floor(this.sizeVector.x * 0.5),
          Math.floor(this.sizeVector.y * 0.5)
        );
        break;
      case "Full":
        this.drt.setSize(this.sizeVector.x, this.sizeVector.y);
        this.rt.setSize(this.sizeVector.x, this.sizeVector.y);
        break;
    }
  }

  compute(TAAProgram, envmapEqui, guiControls, SSRProgram, sceneCamera) {
    let samplesCount = guiControls.samples;
    for (let i = 0; i < samplesCount; i++) {
      SSRProgram.compute(
        TAAProgram.momentMoveRT.write,
        envmapEqui,
        guiControls,
        i
      );

      if (this.usingLinearIntersectionBuffer) {
        if (SSRProgram.SSRRT.read.texture[2].minFilter != THREE.LinearFilter) {
          SSRProgram.SSRRT.read.texture[2].minFilter = THREE.LinearFilter;
          SSRProgram.SSRRT.write.texture[2].minFilter = THREE.LinearFilter;
          SSRProgram.SSRRT.read.texture[2].magFilter = THREE.LinearFilter;
          SSRProgram.SSRRT.write.texture[2].magFilter = THREE.LinearFilter;
        }
      }
      this.material.uniforms.uDisableResolve.value = guiControls.disableResolve;
      this.material.uniforms.uTaps.value = guiControls.resolveTaps;
      this.material.uniforms.uCameraPos.value = sceneCamera.position;
      this.material.uniforms.uSSRData.value = SSRProgram.SSRRT.write.texture[2];
      this.material.uniforms.uSSRColor.value =
        SSRProgram.SSRRT.write.texture[0];
      this.material.uniforms.uSSRIntersection.value =
        SSRProgram.SSRRT.write.texture[1];

      this.mesh.material = this.material;
      this.renderer.setRenderTarget(this.rt);
      this.renderer.render(this.scene, sceneCamera);
      this.renderer.setRenderTarget(null);

      this.drt.swap();

      this.mesh.material = this.accumMaterial;
      this.accumMaterial.uniforms.uPrev.value = this.drt.read.texture;
      this.accumMaterial.uniforms.uNew.value = this.rt.texture;
      this.accumMaterial.uniforms.uSamplesCount.value = samplesCount;
      this.accumMaterial.uniforms.uSampleIndex.value = i;
      this.renderer.setRenderTarget(this.drt.write);
      this.renderer.render(this.scene, sceneCamera);
      this.renderer.setRenderTarget(null);
    }
  }
}
