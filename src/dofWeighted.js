// Multi-pass depth-of-field node.
//
// This follows the newer Three.js TSL DepthOfFieldNode architecture rather than
// the older 41-tap one-pass gather this file started from:
//   1. write separate near/far circle-of-confusion fields,
//   2. blur the near CoC so foreground edges do not stay hard,
//   3. run a half-resolution 64-tap disc blur,
//   4. run a second 16-tap fill/widen pass,
//   5. composite blurred near/far fields over the sharp beauty pass.
//
// The public helper keeps this project's existing signature: focus/aperture/
// maxblur still describe the focus plane and blur strength, and raw perspective
// depth is sampled here so CoC is evaluated in the post pass.

import {
	TempNode,
	NodeMaterial,
	NodeUpdateType,
	RenderTarget,
	Vector2,
	HalfFloatType,
	RedFormat,
	QuadMesh,
	RendererUtils,
} from 'three/webgpu';
import {
	convertToTexture,
	nodeObject,
	Fn,
	uv,
	uniform,
	float,
	vec2,
	vec3,
	vec4,
	clamp,
	abs,
	max,
	min,
	mix,
	step,
	smoothstep,
	texture,
	uniformArray,
	outputStruct,
	property,
	Loop,
	perspectiveDepthToViewZ,
} from 'three/tsl';
import { gaussianBlur } from 'three/examples/jsm/tsl/display/GaussianBlurNode.js';

const _quadMesh = new QuadMesh();
let _rendererState;

// The public maxblur value came from the old single-pass gather. In this
// multi-pass pipeline the 64-tap pass is followed by a fill/widen pass, so using
// the full radius in both passes roughly doubles the apparent blur.
const BOKEH64_RADIUS_SCALE = 0.48;
const BOKEH16_RADIUS_SCALE = 0.28;
const FOCAL_RANGE = 4.0;

class DepthOfFieldWeightedNode extends TempNode {

	static get type() {

		return 'DepthOfFieldWeightedNode';

	}

	constructor( textureNode, depthTextureNode, focusNode, apertureNode, maxblurNode, cameraNearNode, cameraFarNode ) {

		super( 'vec4' );

		this.textureNode = textureNode;
		this.depthTextureNode = depthTextureNode;
		this.focusNode = focusNode;
		this.apertureNode = apertureNode;
		this.maxblurNode = maxblurNode;
		this.cameraNearNode = cameraNearNode;
		this.cameraFarNode = cameraFarNode;

		this._invSize = uniform( new Vector2() );

		this._CoCRT = new RenderTarget( 1, 1, {
			depthBuffer: false,
			type: HalfFloatType,
			format: RedFormat,
			count: 2,
		} );
		this._CoCRT.textures[ 0 ].name = 'DepthOfFieldWeighted.NearField';
		this._CoCRT.textures[ 1 ].name = 'DepthOfFieldWeighted.FarField';

		this._CoCBlurredRT = new RenderTarget( 1, 1, {
			depthBuffer: false,
			type: HalfFloatType,
			format: RedFormat,
		} );
		this._CoCBlurredRT.texture.name = 'DepthOfFieldWeighted.NearFieldBlurred';

		this._blur64RT = new RenderTarget( 1, 1, {
			depthBuffer: false,
			type: HalfFloatType,
		} );
		this._blur64RT.texture.name = 'DepthOfFieldWeighted.Blur64';

		this._blur16NearRT = new RenderTarget( 1, 1, {
			depthBuffer: false,
			type: HalfFloatType,
		} );
		this._blur16NearRT.texture.name = 'DepthOfFieldWeighted.Blur16Near';

		this._blur16FarRT = new RenderTarget( 1, 1, {
			depthBuffer: false,
			type: HalfFloatType,
		} );
		this._blur16FarRT.texture.name = 'DepthOfFieldWeighted.Blur16Far';

		this._compositeRT = new RenderTarget( 1, 1, {
			depthBuffer: false,
			type: HalfFloatType,
		} );
		this._compositeRT.texture.name = 'DepthOfFieldWeighted.Composite';

		this._CoCMaterial = new NodeMaterial();
		this._CoCBlurredMaterial = new NodeMaterial();
		this._blur64Material = new NodeMaterial();
		this._blur16Material = new NodeMaterial();
		this._compositeMaterial = new NodeMaterial();

		this._textureNode = texture( this._compositeRT.texture );
		this._CoCTextureNode = texture( this._CoCRT.texture );
		this._blur64TextureNode = texture( this._blur64RT.texture );
		this._blur16NearTextureNode = texture( this._blur16NearRT.texture );
		this._blur16FarTextureNode = texture( this._blur16FarRT.texture );

		this.updateBeforeType = NodeUpdateType.FRAME;

	}

	setSize( width, height ) {

		this._invSize.value.set( 1 / width, 1 / height );
		this._CoCRT.setSize( width, height );
		this._compositeRT.setSize( width, height );

		const halfWidth = Math.max( 1, Math.round( width / 2 ) );
		const halfHeight = Math.max( 1, Math.round( height / 2 ) );
		this._CoCBlurredRT.setSize( halfWidth, halfHeight );
		this._blur64RT.setSize( halfWidth, halfHeight );
		this._blur16NearRT.setSize( halfWidth, halfHeight );
		this._blur16FarRT.setSize( halfWidth, halfHeight );

	}

	getTextureNode() {

		return this._textureNode;

	}

	updateBefore( frame ) {

		const { renderer } = frame;
		const map = this.textureNode.value;

		this.setSize( map.image.width, map.image.height );

		_rendererState = RendererUtils.resetRendererState( renderer, _rendererState );
		renderer.setClearColor( 0x000000, 0 );

		_quadMesh.material = this._CoCMaterial;
		renderer.setRenderTarget( this._CoCRT );
		_quadMesh.name = 'DoF [ CoC ]';
		_quadMesh.render( renderer );

		this._CoCTextureNode.value = this._CoCRT.textures[ 0 ];
		_quadMesh.material = this._CoCBlurredMaterial;
		renderer.setRenderTarget( this._CoCBlurredRT );
		_quadMesh.name = 'DoF [ CoC Blur ]';
		_quadMesh.render( renderer );

		this._CoCTextureNode.value = this._CoCBlurredRT.texture;
		_quadMesh.material = this._blur64Material;
		renderer.setRenderTarget( this._blur64RT );
		_quadMesh.name = 'DoF [ Blur64 Near ]';
		_quadMesh.render( renderer );

		_quadMesh.material = this._blur16Material;
		renderer.setRenderTarget( this._blur16NearRT );
		_quadMesh.name = 'DoF [ Blur16 Near ]';
		_quadMesh.render( renderer );

		this._CoCTextureNode.value = this._CoCRT.textures[ 1 ];
		_quadMesh.material = this._blur64Material;
		renderer.setRenderTarget( this._blur64RT );
		_quadMesh.name = 'DoF [ Blur64 Far ]';
		_quadMesh.render( renderer );

		_quadMesh.material = this._blur16Material;
		renderer.setRenderTarget( this._blur16FarRT );
		_quadMesh.name = 'DoF [ Blur16 Far ]';
		_quadMesh.render( renderer );

		_quadMesh.material = this._compositeMaterial;
		renderer.setRenderTarget( this._compositeRT );
		_quadMesh.name = 'DoF [ Composite ]';
		_quadMesh.render( renderer );

		RendererUtils.restoreRendererState( renderer, _rendererState );

	}

	setup( builder ) {

		const kernels = this._generateKernels();
		const uvNode = uv();

		const viewZAt = ( uvCoord ) => perspectiveDepthToViewZ(
			this.depthTextureNode.sample( uvCoord ).r,
			this.cameraNearNode,
			this.cameraFarNode,
		);

		const signedDistAt = ( uvCoord ) => viewZAt( uvCoord ).negate().sub( this.focusNode );
		const openAmount = clamp( this.apertureNode.div( 0.012 ), float( 0 ), float( 1 ) );

		const cocAt = ( uvCoord ) => clamp(
			smoothstep( float( 0 ), float( FOCAL_RANGE ), abs( signedDistAt( uvCoord ) ) ).mul( openAmount ),
			float( 0 ),
			float( 1 ),
		);

		const nearField = property( 'float' );
		const farField = property( 'float' );
		const outputNode = outputStruct( nearField, farField );

		const CoCPass = Fn( () => {

			const signedDist = signedDistAt( uvNode );
			const coc = cocAt( uvNode );

			nearField.assign( step( signedDist, float( 0 ) ).mul( coc ) );
			farField.assign( step( float( 0 ), signedDist ).mul( coc ) );

			return vec4( 0 );

		} );

		this._CoCMaterial.colorNode = CoCPass().context( builder.getSharedContext() );
		this._CoCMaterial.outputNode = outputNode;
		this._CoCMaterial.needsUpdate = true;

		this._CoCBlurredMaterial.colorNode = gaussianBlur( this._CoCTextureNode, 1, 2 );
		this._CoCBlurredMaterial.needsUpdate = true;

		// UV space is stretched by the framebuffer aspect, so an equal U/V tap
		// offset travels more screen horizontally than vertically — the bokeh disc
		// smears wide. Shrink the U offset by height/width ( = invSize.x/invSize.y )
		// so the kernel stays circular on screen regardless of aspect.
		const aspectCorrect = vec2( this._invSize.x.div( this._invSize.y ), 1 );

		const bokeh64 = uniformArray( kernels.points64 );
		const blur64 = Fn( () => {

			const acc = vec3().toVar();
			const localUv = uv();
			const coc = this._CoCTextureNode.sample( localUv ).r;
			const sampleStep = vec2( this.maxblurNode ).mul( BOKEH64_RADIUS_SCALE ).mul( coc ).mul( aspectCorrect );

			Loop( 64, ( { i } ) => {

				const tapUv = localUv.add( sampleStep.mul( bokeh64.element( i ) ) );
				const tap = this.textureNode.sample( tapUv );
				acc.addAssign( tap.rgb );

			} );

			acc.divAssign( 64 );

			return vec4( acc, coc );

		} );

		this._blur64Material.fragmentNode = blur64().context( builder.getSharedContext() );
		this._blur64Material.needsUpdate = true;

		const bokeh16 = uniformArray( kernels.points16 );
		const blur16 = Fn( () => {

			const localUv = uv();
			const col = this._blur64TextureNode.sample( localUv ).toVar();
			const acc = col.rgb.toVar();
			const coc = col.a;
			const sampleStep = vec2( this.maxblurNode ).mul( BOKEH16_RADIUS_SCALE ).mul( coc ).mul( aspectCorrect );

			Loop( 16, ( { i } ) => {

				const tapUv = localUv.add( sampleStep.mul( bokeh16.element( i ) ) );
				const tap = this._blur64TextureNode.sample( tapUv );
				acc.addAssign( tap.rgb );

			} );

			return vec4( acc.div( 17 ), coc );

		} );

		this._blur16Material.fragmentNode = blur16().context( builder.getSharedContext() );
		this._blur16Material.needsUpdate = true;

		const composite = Fn( () => {

			const localUv = uv();
			const near = this._blur16NearTextureNode.sample( localUv );
			const far = this._blur16FarTextureNode.sample( localUv );
			const beauty = this.textureNode.sample( localUv );

			const blendNear = min( near.a, 0.5 ).mul( 2 );
			const blendFar = min( far.a, 0.5 ).mul( 2 );

			const result = vec4( 0, 0, 0, 1 ).toVar();
			result.rgb = mix( beauty.rgb, far.rgb, blendFar );
			result.rgb = mix( result.rgb, near.rgb, blendNear );

			return result;

		} );

		this._compositeMaterial.fragmentNode = composite().context( builder.getSharedContext() );
		this._compositeMaterial.needsUpdate = true;

		return this._textureNode;

	}

	_generateKernels() {

		const goldenAngle = 2.39996323;
		const samples = 80;
		const points64 = [];
		const points16 = [];
		let idx64 = 0;
		let idx16 = 0;

		for ( let i = 0; i < samples; i ++ ) {

			const theta = i * goldenAngle;
			const radius = Math.sqrt( i ) / Math.sqrt( samples );
			const point = new Vector2(
				radius * Math.cos( theta ),
				radius * Math.sin( theta ),
			);

			if ( i % 5 === 0 ) {

				points16[ idx16 ] = point;
				idx16 ++;

			} else {

				points64[ idx64 ] = point;
				idx64 ++;

			}

		}

		return { points64, points16 };

	}

	dispose() {

		this._CoCRT.dispose();
		this._CoCBlurredRT.dispose();
		this._blur64RT.dispose();
		this._blur16NearRT.dispose();
		this._blur16FarRT.dispose();
		this._compositeRT.dispose();
		this._CoCMaterial.dispose();
		this._CoCBlurredMaterial.dispose();
		this._blur64Material.dispose();
		this._blur16Material.dispose();
		this._compositeMaterial.dispose();

	}

}

export default DepthOfFieldWeightedNode;

export const dofWeighted = ( node, depthTexture, focus = 1, aperture = 0.025, maxblur = 1, cameraNear = 0.1, cameraFar = 1000 ) =>
	nodeObject( new DepthOfFieldWeightedNode(
		convertToTexture( node ),
		nodeObject( depthTexture ),
		nodeObject( focus ),
		nodeObject( aperture ),
		nodeObject( maxblur ),
		nodeObject( cameraNear ),
		nodeObject( cameraFar ),
	) );
