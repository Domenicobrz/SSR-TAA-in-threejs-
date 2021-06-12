import * as THREE from "three";

export default class GammaAndTonemapping {
    constructor(renderer, args) {
        this.exposure = args.exposure || 1;

        console.warn("REMEMBER TO SET: type: THREE.FloatType TO THE RENDER TARGET USED TO RENDER THE SCENE!")

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { type: "t", value: null },
                toneMappingExposure: { value: this.exposure },
            },
            
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);    
                }
            `,

            fragmentShader: `
                uniform sampler2D uTexture;
                varying vec2 vUv;

                uniform float toneMappingExposure;

                #ifndef saturate
                    #define saturate(a) clamp( a, 0.0, 1.0 )
                #endif

                // vec4 LinearTosRGB( in vec4 value ) {
                // 	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
                // }

                // source: https://github.com/selfshadow/ltc_code/blob/master/webgl/shaders/ltc/ltc_blit.fs
                vec3 RRTAndODTFit( vec3 v ) {
                	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
                	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
                	return a / b;
                }

                // this implementation of ACES is modified to accommodate a brighter viewing environment.
                // the scale factor of 1/0.6 is subjective. see discussion in #19621.

                vec3 ACESFilmicToneMapping( vec3 color ) {
                
                	// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
                	const mat3 ACESInputMat = mat3(
                		vec3( 0.59719, 0.07600, 0.02840 ), // transposed from source
                		vec3( 0.35458, 0.90834, 0.13383 ),
                		vec3( 0.04823, 0.01566, 0.83777 )
                	);
                    
                	// ODT_SAT => XYZ => D60_2_D65 => sRGB
                	const mat3 ACESOutputMat = mat3(
                		vec3(  1.60475, -0.10208, -0.00327 ), // transposed from source
                		vec3( -0.53108,  1.10813, -0.07276 ),
                		vec3( -0.07367, -0.00605,  1.07602 )
                	);
                    
                	color *= toneMappingExposure / 0.6;
                    
                	color = ACESInputMat * color;
                    
                	// Apply RRT and ODT
                	color = RRTAndODTFit( color );
                    
                	color = ACESOutputMat * color;
                    
                	// Clamp to [0, 1]
                	return saturate( color );
                }

                void main() {
                    gl_FragColor = texture2D(uTexture, vUv);

                    gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
                    gl_FragColor = LinearTosRGB(gl_FragColor);
                }
            `,

            depthTest:  false,
            depthWrite: false,
        });

        this.mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2), this.material);
        this.camera = new THREE.PerspectiveCamera( 45, 1 /* remember that the camera is worthless here */, 1, 1000 );
        this.renderer = renderer;

        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);
    }

    compute(renderTargetFrom, renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.material.uniforms.uTexture.value = renderTargetFrom.texture;
        this.material.uniforms.toneMappingExposure.value = this.exposure;
        this.renderer.render(this.scene, this.camera);

        this.renderer.setRenderTarget(null);
    }
}