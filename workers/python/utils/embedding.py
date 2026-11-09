"""
Visual Embedding Generator menggunakan CLIP ViT-B/32
Untuk similarity matching trained symbols
"""
import torch
import open_clip
import numpy as np
from PIL import Image
from typing import Union, List
from pathlib import Path

class EmbeddingGenerator:
    """
    Generate visual embeddings dari cropped symbol images
    Menggunakan CLIP ViT-B/32 (512-dimensional embeddings)
    """
    
    def __init__(self, model_name: str = "ViT-B-32", pretrained: str = "openai", device: str = "cuda"):
        """
        Args:
            model_name: OpenCLIP model variant ('ViT-B-32', 'ViT-B-16', 'RN50')
            pretrained: Pretrained weights ('openai', 'laion2b_s34b_b79k')
            device: 'cuda' atau 'cpu'
        """
        self.device = device if torch.cuda.is_available() else "cpu"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            model_name, pretrained=pretrained, device=self.device
        )
        self.model.eval()
        
    def generate_embedding(self, image: Union[str, Path, Image.Image, np.ndarray]) -> np.ndarray:
        """
        Generate 512-dim embedding dari single image
        
        Args:
            image: Path ke file image, PIL Image, atau numpy array
            
        Returns:
            numpy array shape (512,) normalized embedding
        """
        # Load image jika path
        if isinstance(image, (str, Path)):
            pil_image = Image.open(image).convert("RGB")
        elif isinstance(image, np.ndarray):
            pil_image = Image.fromarray(image).convert("RGB")
        elif isinstance(image, Image.Image):
            pil_image = image.convert("RGB")
        else:
            raise ValueError(f"Unsupported image type: {type(image)}")
        
        # Preprocess dan extract feature
        with torch.no_grad():
            image_tensor = self.preprocess(pil_image).unsqueeze(0).to(self.device)
            image_features = self.model.encode_image(image_tensor)
            
            # Normalize ke unit vector
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            
        # Convert to numpy
        embedding = image_features.cpu().numpy().flatten()
        return embedding.astype(np.float32)
    
    def generate_batch(self, images: List[Union[str, Path, Image.Image]]) -> np.ndarray:
        """
        Generate embeddings untuk batch images (lebih efficient)
        
        Args:
            images: List of image paths atau PIL Images
            
        Returns:
            numpy array shape (N, 512)
        """
        # Load dan preprocess semua images
        tensors = []
        for img in images:
            if isinstance(img, (str, Path)):
                pil_img = Image.open(img).convert("RGB")
            elif isinstance(img, Image.Image):
                pil_img = img.convert("RGB")
            else:
                raise ValueError(f"Unsupported image type in batch: {type(img)}")
            
            tensor = self.preprocess(pil_img)
            tensors.append(tensor)
        
        # Stack dan encode
        batch_tensor = torch.stack(tensors).to(self.device)
        
        with torch.no_grad():
            features = self.model.encode_image(batch_tensor)
            features = features / features.norm(dim=-1, keepdim=True)
        
        embeddings = features.cpu().numpy()
        return embeddings.astype(np.float32)
    
    def cosine_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """
        Compute cosine similarity antara dua embeddings
        
        Returns:
            Float antara 0 (berbeda total) dan 1 (identik)
        """
        return float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2)))
