import * as THREE from "three";
import { Vector2, Vector3 } from "three";
import DoubleRT from "./doubleRT";

export default class Resolve {
  constructor(
    positionTexture,
    normalTexture,
    materialTexture,
    albedoTexture,
    colorTexture,
    renderer,
    blueNoiseTexture
  ) {
    let sizeVector = new THREE.Vector2();
    renderer.getSize(sizeVector);
    this.sizeVector = sizeVector;

    this.keepRTAtFullRes = true;
    this.usingLinearIntersectionBuffer = false;
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
        uEnvmap: { type: "t", value: materialTexture },
        uMaterial: { type: "t", value: materialTexture },
        uPosition: { type: "t", value: positionTexture },
        uNormal: { type: "t", value: normalTexture },
        uAlbedo: { type: "t", value: albedoTexture },
        uColor: { type: "t", value: colorTexture },
        uSSRColor: { type: "t", value: null },
        uSSRIntersection: { type: "t", value: null },
        uSSRData: { type: "t", value: null },
        uInvScreen: { value: new Vector2(1 / innerWidth, 1 / innerHeight) },
        // this one wont be modified if the SSRT size changes
        uFullInvScreen: { value: new Vector2(1 / innerWidth, 1 / innerHeight) },
        uCameraPos: { value: new Vector3(0, 0, 0) },
        uTaps: { value: 9 },
        uDisableResolve: { value: false },
        uSampleIntRand: { value: 0 },
        uBlueNoise: { type: "t", value: blueNoiseTexture },
        uBlueNoiseIndex: { value: new THREE.Vector4(0, 0, 0, 0) },
      },

      vertexShader: `
        varying vec2 vUv;
        varying mat4 vProjViewMatrix;

        void main() {
          vUv = uv;
          vProjViewMatrix = projectionMatrix * viewMatrix;

          gl_Position = vec4(position.xy, 0.0, 1.0);    
        }
      `,

      fragmentShader: `
        varying vec2 vUv;
        varying mat4 vProjViewMatrix;

        uniform sampler2D uSSRColor;
        uniform sampler2D uSSRIntersection;
        uniform sampler2D uSSRData;
        uniform sampler2D uMaterial;
        uniform sampler2D uPosition;
        uniform sampler2D uNormal;
        uniform sampler2D uAlbedo;
        uniform sampler2D uColor;
        uniform sampler2D uBlueNoise;
        uniform sampler2D uEnvmap;

        uniform vec3 uCameraPos;
        uniform vec2 uFullInvScreen;
        uniform vec2 uInvScreen;
        uniform int uTaps;
        uniform vec4 uBlueNoiseIndex;
        uniform bool uDisableResolve;

        uniform int uSampleIntRand;

        #define PI 3.14159

        float rand(float co) { return fract(sin(co*(91.3458)) * 47453.5453); }
        float rand(vec2 co)  { return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
        float rand(vec3 co)  { return rand(co.xy+rand(co.z)); }

        float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
          float a = roughness * roughness;
          float nv = dot(N, V);
          return (2.0 * nv) / (nv + sqrt(a*a + (1.0 - a*a) * nv * nv ));
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

        vec3 SampleBRDF(vec3 wo, vec3 norm, int isample, float roughness, out vec3 out_wm) {
          vec2 blue_uvs = vec2((gl_FragCoord.xy + uBlueNoiseIndex.xy) / 512.0);
          vec4 blue_noise = texture2D(uBlueNoise, blue_uvs);
          
          float r0 = blue_noise.x;
          float r1 = blue_noise.y - 0.33;   

          r0 = fract(r0 + float(isample) * 19.737);
          r1 = fract(r1 + float(isample) * 27.397);
                                                          
          float a = roughness * roughness;
          float a2 = a * a;
          float theta = acos(sqrt((1.0 - r0) / ((a2 - 1.0 ) * r0 + 1.0)));
          float phi = 2.0 * PI * r1;
          float x = sin(theta) * cos(phi);
          float y = cos(theta);
          float z = sin(theta) * sin(phi);
          vec3 wm = normalize(vec3(x, y, z));

          vec3 w = norm;
          if(abs(norm.y) < 0.95) {
            vec3 u = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
            vec3 v = normalize(cross(u, w));
            wm = normalize(wm.y * w + wm.x * u + wm.z * v);                    
          } else {
            vec3 u = normalize(cross(w, vec3(0.0, 0.0, 1.0)));
            vec3 v = normalize(cross(u, w));
            wm = normalize(wm.y * w + wm.x * u + wm.z * v);
          }

          vec3 wi = reflect(wo, wm);
          out_wm = wm;
          return wi;
        }
        
        float samplePDF(vec3 wi, vec3 wo, vec3 norm, float roughness) {
          vec3 wg = norm;
          vec3 wm = normalize(wo + wi);
          float a = roughness * roughness;
          float a2 = a * a;
          float cosTheta = dot(wg, wm);
          float exp = (a2 - 1.0) * cosTheta * cosTheta + 1.0;
          float D = a2 / (PI * exp * exp);
          return (D * dot(wm, wg)) / (4.0 * dot(wo,wm));
        }

        // vec3 _RRTAndODTFit( vec3 v ) {
        //   vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
        //   vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
        //   return a / b;
        // }
        vec3 custom_ACESFilmicToneMapping( vec3 color ) {
          const mat3 ACESInputMat = mat3(
          vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 )
          );
          const mat3 ACESOutputMat = mat3(
          vec3(  1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 )
          );
          float toneMappingExposure = 1.0;
          color *= toneMappingExposure / 0.6;
          color = ACESInputMat * color;
          color = RRTAndODTFit( color );
          color = ACESOutputMat * color;
          return saturate( color );
        }
        // vec4 RGBEToLinear( in vec4 value ) {
        //   return vec4( value.rgb * exp2( value.a * 255.0 - 128.0 ), 1.0 );
        // }

        vec3 getEnvmapRadiance(vec3 idir) {
          vec3 dir = vec3(idir.zyx);

          // skybox coordinates
          vec2 skyboxUV = vec2(
            (atan(dir.x, dir.z) + PI) / (PI * 2.0),
            (asin(dir.y) + PI * 0.5) / (PI)
          );
          // vec3 radianceClamp = vec3(100.0);
          vec3 col = vec3(0.0);

          col = custom_ACESFilmicToneMapping(RGBEToLinear(texture2D(uEnvmap, skyboxUV)).xyz);

          return col;
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


          // THIS SHADER IS NOT USING THE UNCOMPRESSED ENV
          // THIS SHADER IS NOT USING THE UNCOMPRESSED ENV
          // THIS SHADER IS NOT USING THE UNCOMPRESSED ENV
          // THIS SHADER IS NOT USING THE UNCOMPRESSED ENV
          // THIS SHADER IS NOT USING THE UNCOMPRESSED ENV
          // THIS SHADER IS NOT USING THE UNCOMPRESSED ENV


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

          // vec3 lweight;
          vec3 intersectionP;
          {
            // vec2 roffs = vec2(
            //   (rand(
            //     mod(gl_FragCoord.x, 35.0) + mod(gl_FragCoord.y, 35.0) + float(uSampleIntRand) * 0.679 * 19.783
            //   ) * 2.0 - 1.0) * uInvScreen.x * 4.0,
            //   (rand(
            //     mod(gl_FragCoord.x, 15.0) + mod(gl_FragCoord.y, 19.0) + float(uSampleIntRand) * 1.78 * 29.783
            //   ) * 2.0 - 1.0) * uInvScreen.y * 4.0
            // );
            // vec4 localData = texture2D(uSSRData, vUv + roffs);
            vec4 localData = texture2D(uSSRData, vUv);
            intersectionP = localData.xyz;

            // vec3 wi = normalize(intersectionP - pos);
            // vec3 wo = -viewDir;
            // vec3 localBrdf = clamp(EvalBRDF(wi, wo, norm, roughness, F0), 0.00001, 100.0);
            // float pdf = localData.w;
            // lweight = localBrdf / pdf;
          }

          vec4 ssrColorData = texture2D(uSSRColor, vUv);
          bool intersected = ssrColorData.w > 0.5 ? true : false;

          // *********** new method ***********
          for (int i = 0; i < 8; i++) {
            vec3 wm;
            int sampleIndex = i + int(mod(gl_FragCoord.x, 35.0)) + int(mod(gl_FragCoord.y, 35.0)) + uSampleIntRand;
            // ************* THIS IS WRONG: MAKE SURE EACH PIXEL
            // ************* GETS A DIFFERENT SET OF DIRECTIONS / sampleIndex 
            // ************* ---- ALSO DIFFERENT DIRECTIONS FOR EACH FRAME 
            vec3 reflDir = SampleBRDF(viewDir, norm, sampleIndex, roughness, wm);
            reflDir = normalize(reflDir);
            // unfortunately, this even seems very common after a set roughness level
            if(dot(reflDir, norm) < 0.0) {
              // one last attempt, and whatever happens happens
              reflDir = SampleBRDF(viewDir, norm, sampleIndex + 79, roughness, wm);
            }
            // using this second attempt can be significant in terms of performance unfortunately,
            // and it doesn't seem to improve significantly the output
            // if(dot(reflDir, norm) < 0.0) {
            //   // one last attempt, and whatever happens happens
            //   reflDir = SampleBRDF(viewDir, norm, sampleIndex + 790, roughness, wm);
            // }

            float pdf = samplePDF(reflDir, -viewDir, norm, roughness);
            pdf = clamp(pdf, 0.1, 100.0);

            vec3 brdf = EvalBRDF(reflDir, -viewDir, norm, roughness, F0);
            brdf = clamp(brdf, 0.00001, 100.0);
            vec3 weight = brdf / pdf;

            float dist = length(intersectionP - pos);
            vec3 p2 = pos + reflDir * dist;

            vec4 projP2 = vProjViewMatrix * vec4(p2, 1.0);
            vec2 p2Uv = (projP2 / projP2.w).xy * 0.5 + 0.5;
            p2Uv.x = clamp(p2Uv.x, 0.0, 1.0);
            p2Uv.y = clamp(p2Uv.y, 0.0, 1.0);  

            if (
              intersected && 
              (p2Uv.x >= 0.0 && p2Uv.x <= 1.0 && p2Uv.y >= 0.0 && p2Uv.y <= 1.0)
            ) {
              vec3 color = texture2D(uColor, p2Uv).xyz;
              result += color * weight;
              weightSum += vec3(1.0);
            } else {
              vec3 envColor = getEnvmapRadiance(reflDir) * weight; 
              result += envColor;
              weightSum += vec3(1.0);
            }
          }

          // if (uTaps == 25) {
          //   for (int i = -2; i <= 2; i++) {
          //     for (int j = -2; j <= 2; j++) {
          //       vec2 offs = vec2(i, j) * uInvScreen;
          //       tap(result, weightSum, offs, pos, norm, roughness, F0, viewDir);
          //     }
          //   }
          // } else if (uTaps == 9) {
          //   for (int i = -1; i <= 1; i++) {
          //     for (int j = -1; j <= 1; j++) {
          //       vec2 offs = vec2(i, j) * uInvScreen;
          //       tap(result, weightSum, offs, pos, norm, roughness, F0, viewDir);
          //     }
          //   }
          // } else if (uTaps == 4) {
          //   for (int i = 0; i <= 1; i++) {
          //     for (int j = 0; j <= 1; j++) {
          //       vec2 offs = vec2(i, j) * uInvScreen;
          //       tap(result, weightSum, offs, pos, norm, roughness, F0, viewDir);
          //     }
          //   }
          // }

          result /= weightSum;

          if (uDisableResolve) {
            result = texture2D(uSSRColor, vUv).xyz;
          }

          // // control group
          // result = texture2D(uSSRColor, vUv).xyz * lweight;
          // weightSum = vec3(1.0);
  
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

    this.blueNoiseIndex = new THREE.Vector4(0, 0, 0, 0);
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

      this.blueNoiseIndex.setX(Math.floor(Math.random() * 512));
      this.blueNoiseIndex.setY(Math.floor(Math.random() * 512));
      this.material.uniforms.uBlueNoiseIndex.value = this.blueNoiseIndex;

      if (this.usingLinearIntersectionBuffer) {
        if (SSRProgram.SSRRT.read.texture[2].minFilter != THREE.LinearFilter) {
          SSRProgram.SSRRT.read.texture[2].minFilter = THREE.LinearFilter;
          SSRProgram.SSRRT.write.texture[2].minFilter = THREE.LinearFilter;
          SSRProgram.SSRRT.read.texture[2].magFilter = THREE.LinearFilter;
          SSRProgram.SSRRT.write.texture[2].magFilter = THREE.LinearFilter;
        }
      }
      this.material.uniforms.uEnvmap.value = envmapEqui;
      this.material.uniforms.uDisableResolve.value = guiControls.disableResolve;
      this.material.uniforms.uTaps.value = guiControls.resolveTaps;
      this.material.uniforms.uSampleIntRand.value = Math.floor(
        Math.random() * 350
      );
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
