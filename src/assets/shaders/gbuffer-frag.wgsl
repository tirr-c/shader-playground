@group(0) @binding(1) var obj_texture: texture_2d<f32>;
@group(0) @binding(2) var obj_sampler: sampler;

@group(1) @binding(0) var<uniform> uniforms: Uniforms;

struct GBufferFragOut {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: u32,
}

@fragment
fn main(frag_data: GBufferVertexOut) -> GBufferFragOut {
  var output: GBufferFragOut;

  let albedo_texture = textureSample(obj_texture, obj_sampler, frag_data.uv_or_color.xy);
  if (frag_data.uv_or_color.w < 0.0) {
    output.albedo = albedo_texture;
  } else {
    output.albedo = frag_data.uv_or_color;
  }

  output.normal = normalize(frag_data.normal_w);
  output.material = frag_data.material_kind;

  return output;
}
